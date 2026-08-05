const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const DEFAULT_MODEL = 'gemini-3.6-flash';

/** Tried in order when the requested model is rejected as unknown. */
const MODEL_FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash'];

/** Roughly two printed lines at the report's text width. */
const SUMMARY_LIMIT = 200;

/** Half-hour steps: from half an hour of work up to a full week of it. */
const MIN_ESTIMATE_MINUTES = 30;
const MAX_ESTIMATE_MINUTES = 2400;
const ESTIMATE_STEP_MINUTES = 30;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', maxLength: '70' },
    summary: { type: 'STRING', maxLength: String(SUMMARY_LIMIT) },
    estimatedMinutes: { type: 'INTEGER' },
  },
  required: ['title', 'summary', 'estimatedMinutes'],
};

const SYSTEM_PROMPT = `You are writing a daily work report that a software developer sends to a non-technical client.

You receive the raw git commits of one project for one day. Rewrite them as business value delivered.

Rules:
- Write in clear, simple English that someone with no technical background understands.
- Never mention git, commits, branches, merges, refactoring, code, components, hooks, APIs, endpoints, variables, files or library names.
- Talk about the product and the user experience: pages, screens, forms, buttons, texts, images, speed, errors that were fixed, new possibilities.
- Never invent work that is not in the commits. If a commit is unclear, describe it in a broad but honest way.
- Group related commits together instead of translating them one by one. Several small commits about the same thing become one sentence.
- Stay factual and calm. No marketing hype, no exclamation marks, no emojis.
- The date is already printed above your text, so never open with "Today" or name the day.
- Make every word carry information. No filler openings, no restating the same work in other words.

Return JSON with:
- "title": a short headline of the day for this project, maximum 8 words.
- "summary": the complete description of the day, as one paragraph of at most 2 sentences and at most ${SUMMARY_LIMIT} characters in total. This is a hard limit: it must never be longer than two printed lines.
- "estimatedMinutes": how much work this day represents, in minutes, as a whole number.

The summary is the only text the client reads, so it must be complete and dense. Cover every distinct piece of work of the day, folding the smaller ones into a shared clause, and drop nothing that the client would care about. Write it as plain running prose: never use bullet points, dashes, numbering, line breaks or any other kind of list.

Base the estimate on the work itself: what the changes do, how many files they touch, how much they add or remove. The times on the commits tell you nothing, they are when the work was saved and not how long it took. Assume a developer working with an AI assistant, so the pace is fast, and always include the testing, the review and the deployment in the number. Never cap the number at a working day: one batch of commits often carries work spread over several days.`;

function buildUserPrompt({ projectName, date, commits }) {
  const lines = commits.map((commit, index) => {
    const parts = [`Commit ${index + 1}: ${commit.subject}`];
    if (commit.body) parts.push(`Details: ${commit.body.replace(/\s+/g, ' ').slice(0, 700)}`);
    if (commit.files.length) {
      const shown = commit.files.slice(0, 12).join(', ');
      const rest = commit.files.length > 12 ? ` (+${commit.files.length - 12} more)` : '';
      parts.push(`Touched: ${shown}${rest}`);
    }
    return parts.join('\n');
  });

  return [
    `Project: ${projectName}`,
    `Date: ${date}`,
    `Number of commits: ${commits.length}`,
    '',
    lines.join('\n\n'),
  ].join('\n');
}

/** Cuts on a word boundary so a clipped line still reads as words, not letters. */
function clampWords(text, limit) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;

  const head = clean.slice(0, limit - 1);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > limit * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.replace(/[\s,;:.]+$/, '')}\u2026`;
}

/**
 * Folds a list back into running prose. The report shows the description as a
 * single paragraph, so bullets, dashes and numbering must not survive.
 */
function toProse(text) {
  const parts = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-*+\u2022\u00B7\u2013\u2014]+|\d+[.)])\s+/, '').trim())
    .filter(Boolean);

  return parts
    .map((part, index) => (index === parts.length - 1 || /[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

/**
 * Keeps the model inside the length promised in the prompt. Whole sentences are
 * dropped from the end first, so the text still reads as finished prose.
 */
function clampSentences(text, limit) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;

  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  let kept = '';

  for (const sentence of sentences) {
    if ((kept + sentence).trim().length > limit) break;
    kept += sentence;
  }

  return kept.trim() || clampWords(clean, limit);
}

/**
 * Half-hour steps keep the printed estimate honest about how precise it is.
 * Anything that is not a positive number is dropped, so the report shows no
 * estimate rather than a wrong one.
 */
function normalizeEstimate(value) {
  const minutes = typeof value === 'string' ? Number(value) : value;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;

  const bounded = Math.min(Math.max(minutes, MIN_ESTIMATE_MINUTES), MAX_ESTIMATE_MINUTES);
  return Math.round(bounded / ESTIMATE_STEP_MINUTES) * ESTIMATE_STEP_MINUTES;
}

function parseJsonLoosely(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ModelNotFoundError extends Error {}

/** A failure that retrying cannot fix, such as a rejected key or a bad request. */
class PermanentError extends Error {}

async function callModel({ apiKey, model, prompt, timeout, baseUrl }) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${baseUrl}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw new ModelNotFoundError(`Model "${model}" is not available for this API key`);
      }

      if (response.status === 401 || response.status === 403) {
        const detail = await response.text();
        throw new PermanentError(
          `Google AI rejected the API key (${response.status}): ${detail.slice(0, 200)}`,
        );
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Google AI is unavailable (${response.status})`);
        await sleep(1500 * 2 ** attempt);
        continue;
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new PermanentError(
          `Google AI request failed (${response.status}): ${detail.slice(0, 300)}`,
        );
      }

      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!text) {
        const reason = payload?.candidates?.[0]?.finishReason ?? 'unknown reason';
        throw new Error(`Google AI returned an empty answer (${reason})`);
      }

      const parsed = parseJsonLoosely(text);
      if (!parsed) throw new Error('Google AI returned an answer that is not valid JSON');
      return parsed;
    } catch (error) {
      if (error instanceof ModelNotFoundError || error instanceof PermanentError) throw error;
      if (error.name === 'AbortError') {
        lastError = new Error(`Google AI timed out after ${Math.round(timeout / 1000)}s`);
      } else {
        lastError = error;
      }
      if (attempt === 2) break;
      await sleep(1500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('Google AI request failed');
}

/** Runs `worker` over `items`, at most `limit` at a time, preserving order. */
async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Writes one client-facing description per project/day.
 *
 * A failure on a single group is stored on that group as `error` instead of
 * aborting the whole report.
 */
export async function describeDays(projects, options) {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    concurrency = 4,
    timeout = 60_000,
    baseUrl = API_BASE,
    onProgress,
  } = options;

  const groups = projects.flatMap((project) =>
    project.days.map((day) => ({ project, day })),
  );

  let activeModel = model;
  const fallbacks = MODEL_FALLBACKS.filter((candidate) => candidate !== model);
  let done = 0;

  await mapWithLimit(groups, concurrency, async ({ project, day }) => {
    const prompt = buildUserPrompt({
      projectName: project.name,
      date: day.date,
      commits: day.commits,
    });

    for (;;) {
      try {
        const result = await callModel({
          apiKey,
          model: activeModel,
          prompt,
          timeout,
          baseUrl,
        });
        day.ai = {
          title: typeof result.title === 'string' ? clampWords(result.title, 70) : null,
          summary:
            typeof result.summary === 'string'
              ? clampSentences(toProse(result.summary), SUMMARY_LIMIT)
              : null,
          estimatedMinutes: normalizeEstimate(result.estimatedMinutes),
          model: activeModel,
        };
        break;
      } catch (error) {
        if (error instanceof ModelNotFoundError && fallbacks.length > 0) {
          activeModel = fallbacks.shift();
          continue;
        }
        day.error = error.message;
        break;
      }
    }

    done += 1;
    onProgress?.({ done, total: groups.length, project: project.name, date: day.date });
  });

  return { total: groups.length, model: activeModel };
}
