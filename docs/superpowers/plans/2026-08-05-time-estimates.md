# Estimated Time Per Working Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each project/day block of the report shows how long that day of work is worth, and the header shows the total.

**Architecture:** The estimate is asked for in the AI call that already writes the day, as a third field of the same JSON answer, so no extra request is made. `src/ai.js` normalises it onto `day.ai.estimatedMinutes`; `src/report.js` formats it next to the date and sums it for a header card. A day the AI did not write has no estimate.

**Tech Stack:** Node.js ESM, no dependencies, `node --test`, Google AI Studio (Gemini) REST API.

## Global Constraints

- Node.js `>=18.17`, ES modules, zero runtime dependencies.
- The report is one self-contained HTML file: no external assets, no fetches.
- All report copy is English and non-technical.
- Estimates live on half-hour steps, minimum 30 minutes, maximum 2400 minutes.
- A day without an AI description shows no estimate.

---

### Task 1: The estimate in the AI answer

**Files:**
- Modify: `src/ai.js:8-18` (constants and response schema), `src/ai.js:20-38` (system prompt), `src/ai.js:104` (add `normalizeEstimate` after `clampSentences`), `src/ai.js:271-278` (storing `day.ai`)
- Test: `test/ai.test.js`

**Interfaces:**
- Produces: `day.ai.estimatedMinutes`, a whole number of minutes on a 30-minute step between 30 and 2400, or `null` when the model returned something unusable. `day.ai.title`, `day.ai.summary` and `day.ai.model` are unchanged. A day that failed keeps `day.error` and no `day.ai`, as today.

- [ ] **Step 1: Write the failing tests**

Add to the end of `test/ai.test.js`:

```js
test('describeDays stores the estimate rounded to the nearest half hour', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes: 200 })),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  assert.equal(projects[0].days[0].ai.estimatedMinutes, 210);
});

test('describeDays keeps the estimate inside its bounds', async () => {
  const api = await startMock((entry, res, count) => {
    const estimatedMinutes = count === 1 ? 4 : 99_999;
    jsonReply(res, 200, candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes })));
  });

  const small = sampleProjects();
  await describeDays(small, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(small[0].days[0].ai.estimatedMinutes, 30);

  const huge = sampleProjects();
  await describeDays(huge, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(huge[0].days[0].ai.estimatedMinutes, 2400);
});

test('describeDays drops an estimate that is not a usable number', async () => {
  const api = await startMock((entry, res, count) => {
    const estimatedMinutes = count === 1 ? 'about a day' : -60;
    jsonReply(res, 200, candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes })));
  });

  const words = sampleProjects();
  await describeDays(words, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(words[0].days[0].ai.estimatedMinutes, null);
  assert.equal(words[0].days[0].ai.summary, 'S', 'the description must survive a bad estimate');

  const negative = sampleProjects();
  await describeDays(negative, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(negative[0].days[0].ai.estimatedMinutes, null);
});

test('describeDays asks the model for the estimate', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes: 60 })),
    );
  });

  await describeDays(sampleProjects(), { apiKey: 'k', baseUrl: api.baseUrl });

  const { responseSchema } = api.requests[0].body.generationConfig;
  assert.equal(responseSchema.properties.estimatedMinutes.type, 'INTEGER');
  assert.ok(responseSchema.required.includes('estimatedMinutes'));

  const system = api.requests[0].body.systemInstruction.parts[0].text;
  assert.match(system, /estimatedMinutes/);
  assert.match(system, /deployment/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ai.test.js`
Expected: FAIL, the four new tests report `undefined` instead of the numbers and `responseSchema.properties.estimatedMinutes` is undefined.

- [ ] **Step 3: Add the bounds and the schema field**

In `src/ai.js`, after the `SUMMARY_LIMIT` constant:

```js
/** Half-hour steps: from half an hour of work up to a full week of it. */
const MIN_ESTIMATE_MINUTES = 30;
const MAX_ESTIMATE_MINUTES = 2400;
const ESTIMATE_STEP_MINUTES = 30;
```

Replace `RESPONSE_SCHEMA` with:

```js
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', maxLength: '70' },
    summary: { type: 'STRING', maxLength: String(SUMMARY_LIMIT) },
    estimatedMinutes: { type: 'INTEGER' },
  },
  required: ['title', 'summary', 'estimatedMinutes'],
};
```

- [ ] **Step 4: Ask the model for the number**

In `SYSTEM_PROMPT`, extend the returned-JSON list. After the `"summary"` bullet, add:

```
- "estimatedMinutes": how much work this day represents, in minutes, as a whole number.
```

and add this paragraph at the end of the prompt, after the paragraph about the summary:

```
Base the estimate on the work itself: what the changes do, how many files they touch, how much they add or remove. The times on the commits tell you nothing, they are when the work was saved and not how long it took. Assume a developer working with an AI assistant, so the pace is fast, and always include the testing, the review and the deployment in the number. Never cap the number at a working day: one batch of commits often carries work spread over several days.
```

- [ ] **Step 5: Normalise and store the number**

In `src/ai.js`, after `clampSentences`:

```js
/**
 * Half-hour steps keep the printed estimate honest about how precise it is.
 * Anything the model returns that is not a positive number is dropped, so the
 * report shows no estimate rather than a wrong one.
 */
function normalizeEstimate(value) {
  const minutes = typeof value === 'string' ? Number(value) : value;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;

  const bounded = Math.min(Math.max(minutes, MIN_ESTIMATE_MINUTES), MAX_ESTIMATE_MINUTES);
  return Math.round(bounded / ESTIMATE_STEP_MINUTES) * ESTIMATE_STEP_MINUTES;
}
```

In `describeDays`, extend the stored object:

```js
        day.ai = {
          title: typeof result.title === 'string' ? clampWords(result.title, 70) : null,
          summary:
            typeof result.summary === 'string'
              ? clampSentences(toProse(result.summary), SUMMARY_LIMIT)
              : null,
          estimatedMinutes: normalizeEstimate(result.estimatedMinutes),
          model: activeModel,
        };
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, every test file included.

- [ ] **Step 7: Commit**

```bash
git add src/ai.js test/ai.test.js
git commit -m "feat: ask the model how much work each day represents"
```

---

### Task 2: The estimate in the report

**Files:**
- Modify: `src/report.js:70-105` (`renderDay`), `src/report.js:125-142` (`renderStats`), `src/report.js:225-238` (day styles), `src/report.js:343-393` (`renderReport`)
- Modify: `README.md:70-78` ("How it works")
- Test: `test/ai.test.js`

**Interfaces:**
- Consumes: `day.ai.estimatedMinutes` from Task 1, a number of minutes or `null`.
- Produces: `formatEstimate(minutes)`, module-private, returning `≈ 30min`, `≈ 5h`, `≈ 2h30`, or `null` for `0`, `null` and `undefined`. `renderStats(totals, estimatedMinutes)` gains a second parameter.

- [ ] **Step 1: Write the failing tests**

Add to the end of `test/ai.test.js`:

```js
test('the rendered report shows the day estimate and the total', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: 'Basket work',
          summary: 'Customers can now enter a discount code.',
          estimatedMinutes: 150,
        }),
      ),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  const html = renderReport({
    projects,
    totals: summarizeTotals(projects),
    meta: {
      from: '2026-08-03',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: 'gemini-3.6-flash',
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  assert.match(html, /<span class="est">\u2248 2h30<\/span>/);
  assert.match(html, /Estimated hours/);
  assert.match(html, /<span class="stat-value">\u2248 2h30<\/span>/);
});

test('a report without estimates carries no estimate markup', () => {
  const html = renderReport({
    projects: sampleProjects(),
    totals: summarizeTotals(sampleProjects()),
    meta: {
      from: '2026-08-03',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: null,
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  assert.ok(!html.includes('<span class="est">'), 'no day should carry a badge');
  assert.ok(!html.includes('Estimated hours'), 'the header card should be left out');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ai.test.js`
Expected: FAIL on the first new test, `<span class="est">` and `Estimated hours` are absent from the HTML. The second new test passes already; it guards the empty case for later.

- [ ] **Step 3: Format the estimate**

In `src/report.js`, after `branchLabel`:

```js
/** The estimate is a half-hour figure, so it prints as hours and halves. */
function formatEstimate(minutes) {
  if (!minutes) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `\u2248 ${rest}min`;
  return rest ? `\u2248 ${hours}h${rest}` : `\u2248 ${hours}h`;
}
```

- [ ] **Step 4: Print it next to the date**

In `renderDay`, after the `title` line:

```js
  const estimate = formatEstimate(day.ai?.estimatedMinutes);
  const dateLine = estimate
    ? `${escapeHtml(formatDate(day.date))} <span class="est">${estimate}</span>`
    : escapeHtml(formatDate(day.date));
```

and replace the date paragraph in the returned template with:

```js
              <p class="day-date">${dateLine}</p>
```

- [ ] **Step 5: Style the badge**

In `STYLES`, after the `.day-date` rule:

```css
    .est {
      display: inline-block;
      margin-left: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
```

The print block hides `.copy`, `.tech` and `.footer` only, so the badge survives `Cmd+P`. Leave it alone.

- [ ] **Step 6: Add the header card**

Replace `renderStats` with:

```js
function renderStats(totals, estimatedMinutes) {
  const cards = [
    ['Projects', totals.projects],
    ['Working days', totals.days],
    ['Changes delivered', totals.commits],
    ['Files touched', totals.files],
  ];

  const estimate = formatEstimate(estimatedMinutes);
  if (estimate) cards.push(['Estimated hours', estimate]);

  return cards
    .map(
      ([label, value]) => `
        <div class="stat">
          <span class="stat-value">${value}</span>
          <span class="stat-label">${label}</span>
        </div>`,
    )
    .join('');
}
```

In `renderReport`, before the returned template:

```js
  // Summed here and not in `summarizeTotals`, which runs before the AI pass.
  const estimatedMinutes = projects.reduce(
    (total, project) =>
      total + project.days.reduce((sum, day) => sum + (day.ai?.estimatedMinutes ?? 0), 0),
    0,
  );
```

and pass it through:

```js
    <div class="stats">${renderStats(totals, estimatedMinutes)}</div>
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, including the two new rendering tests.

- [ ] **Step 8: Document it**

In `README.md`, in "How it works", replace step 4 with:

```markdown
4. **Describe** — sends each project/day batch to Gemini and asks for a headline, one dense paragraph, at most two lines and never a list, covering everything delivered that day in non-technical English, and an estimate of the work that day represents. The estimate is read from the changes themselves, never from the times on the commits, assumes a developer working with an AI assistant, and includes testing, review and deployment. It is shown next to the date and totalled at the top of the report, and it is absent from any day the AI did not describe, so `--no-ai` produces a report with no estimates at all. Each description has a copy button in the report.
```

- [ ] **Step 9: Commit**

```bash
git add src/report.js test/ai.test.js README.md
git commit -m "feat: show the estimated time of each day in the report"
```

---

### Task 3: Look at a real report

**Files:**
- None. This task only runs the tool and reads its output.

- [ ] **Step 1: Regenerate the working report**

Run: `node src/cli.js --from 2026-07-18 --to 2026-08-04 --out /tmp/estimate-check.html`
Expected: the run finishes and prints the output path. A `429` on some days is fine, those days must simply carry no estimate.

- [ ] **Step 2: Check the output**

Run: `grep -c 'class="est"' /tmp/estimate-check.html && grep -o 'Estimated hours' /tmp/estimate-check.html`
Expected: one badge per day the AI described, and one `Estimated hours` label.

- [ ] **Step 3: Read the numbers**

Open `/tmp/estimate-check.html` and check that each estimate is believable next to its description, for instance that the 1746-line Arkanoid day is worth clearly more than the one-line sanitisation fix. If a number looks wrong, report it rather than patching the prompt blindly.
