const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const formatDate = (isoDay) => LONG_DATE.format(new Date(`${isoDay}T12:00:00Z`));

const prettyProjectName = (name) =>
  name
    .replace(/[-_]/g, ' ')
    .replace(/\b(fe|be|app|web)\b/gi, (match) => match.toUpperCase())
    .replace(/\b\w/g, (char) => char.toUpperCase());

const branchLabel = (branches) => (branches.length ? branches.join(', ') : '—');

/** The estimate is a half-hour figure, so it prints as hours and halves. */
function formatEstimate(minutes) {
  if (!minutes) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `\u2248 ${rest}min`;
  return rest ? `\u2248 ${hours}h${rest}` : `\u2248 ${hours}h`;
}

function renderBranchTags(branches) {
  if (!branches?.length) return '';
  const tags = branches
    .map((branch) => `<span class="tag branch">${escapeHtml(branch)}</span>`)
    .join(' ');
  return `<span class="branches">${branches.length === 1 ? 'Branch' : 'Branches'} ${tags}</span>`;
}

function renderCommitTable(commits, branches = []) {
  const rows = commits
    .map(
      (commit) => `
              <tr>
                <td class="mono muted">${escapeHtml(commit.time)}</td>
                <td class="mono muted">${escapeHtml(commit.shortHash)}</td>
                <td class="mono muted">${escapeHtml(branchLabel(commit.branches ?? []))}</td>
                <td>${escapeHtml(commit.subject)}</td>
                <td class="numeric"><span class="add">+${commit.insertions}</span> <span class="del">-${commit.deletions}</span></td>
                <td class="numeric muted">${commit.files.length}</td>
              </tr>`,
    )
    .join('');

  const heading = [
    `Technical detail &middot; ${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}`,
    branches.length ? escapeHtml(branches.join(', ')) : null,
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return `
          <details class="tech">
            <summary>${heading}</summary>
            <table>
              <thead>
                <tr><th>Time</th><th>Ref</th><th>Branch</th><th>Change</th><th class="numeric">Lines</th><th class="numeric">Files</th></tr>
              </thead>
              <tbody>${rows}
              </tbody>
            </table>
          </details>`;
}

function renderDay(day) {
  const stats = day.commits.reduce(
    (acc, commit) => ({
      insertions: acc.insertions + commit.insertions,
      deletions: acc.deletions + commit.deletions,
      files: acc.files + commit.files.length,
    }),
    { insertions: 0, deletions: 0, files: 0 },
  );

  const title = day.ai?.title ? escapeHtml(day.ai.title) : 'Work carried out';

  const estimate = formatEstimate(day.ai?.estimatedMinutes);
  const dateLine = estimate
    ? `${escapeHtml(formatDate(day.date))} <span class="est">${estimate}</span>`
    : escapeHtml(formatDate(day.date));

  const summary = day.ai?.summary
    ? `<div class="summary-row">
            <p class="summary">${escapeHtml(day.ai.summary)}</p>
            <button class="copy" type="button" title="Copy this description" data-copy="${escapeHtml(day.ai.summary)}">Copy</button>
          </div>`
    : `<p class="summary muted">${
        day.error
          ? `No plain-language summary available for this day (${escapeHtml(day.error)}).`
          : 'No plain-language summary available for this day.'
      }</p>`;

  return `
        <article class="day">
          <header class="day-head">
            <div>
              <p class="day-date">${dateLine}</p>
              <h3>${title}</h3>
            </div>
            <p class="day-meta">${day.commits.length} ${day.commits.length === 1 ? 'change' : 'changes'} &middot; ${stats.files} ${stats.files === 1 ? 'file' : 'files'}</p>
          </header>
          ${summary}
          ${renderCommitTable(day.commits, day.branches ?? [])}
        </article>`;
}

function renderProject(project) {
  const dayCount = project.days.length;

  return `
      <section class="project">
        <header class="project-head">
          <h2>${escapeHtml(prettyProjectName(project.name))}</h2>
          <p class="project-meta">
            <span class="tag">${escapeHtml(project.name)}</span>
            <span>${project.commitCount} ${project.commitCount === 1 ? 'change' : 'changes'}</span>
            <span>${dayCount} ${dayCount === 1 ? 'working day' : 'working days'}</span>
            ${renderBranchTags(project.branches)}
          </p>
        </header>
        ${project.days.map(renderDay).join('')}
      </section>`;
}

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

const STYLES = `
    :root {
      --bg: #f5f6f8;
      --card: #ffffff;
      --ink: #14161a;
      --ink-soft: #5c6470;
      --line: #e4e7ec;
      --accent: #2f5fe0;
      --accent-soft: #eef2fd;
      --add: #17803d;
      --del: #b42318;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 48px 24px 96px;
      background: var(--bg);
      color: var(--ink);
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 900px; margin: 0 auto; }
    .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 13px; }
    .muted { color: var(--ink-soft); }
    .numeric { text-align: right; white-space: nowrap; }
    .add { color: var(--add); }
    .del { color: var(--del); }

    .report-head {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 32px;
      margin-bottom: 20px;
    }
    .eyebrow {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .report-head h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.2; letter-spacing: -0.02em; }
    .report-head .period { margin: 0; color: var(--ink-soft); }
    .report-head .byline { margin: 20px 0 0; padding-top: 20px; border-top: 1px solid var(--line); font-size: 14px; color: var(--ink-soft); }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 32px;
    }
    .stat {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .stat-value { font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }
    .stat-label { font-size: 13px; color: var(--ink-soft); }

    .project { margin-bottom: 40px; }
    .project-head { margin-bottom: 14px; }
    .project-head h2 { margin: 0 0 6px; font-size: 21px; letter-spacing: -0.01em; }
    .project-meta { margin: 0; display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 13px; color: var(--ink-soft); }
    .tag {
      background: var(--accent-soft);
      color: var(--accent);
      border-radius: 999px;
      padding: 2px 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .branches { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }
    .tag.branch { background: #eef0f4; color: var(--ink-soft); }

    .day {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 12px;
    }
    .day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
    .day-date { margin: 0 0 2px; font-size: 13px; color: var(--ink-soft); }
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
    .day-head h3 { margin: 0; font-size: 18px; letter-spacing: -0.01em; }
    .day-meta { margin: 0; font-size: 13px; color: var(--ink-soft); white-space: nowrap; }
    .summary { margin: 14px 0 0; }
    .summary-row { display: flex; align-items: flex-start; gap: 12px; margin-top: 14px; }
    .summary-row .summary { margin: 0; flex: 1; }
    .copy {
      flex: none;
      /* Wide enough for the "Copied" label, so the row does not jump on click. */
      min-width: 68px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      color: var(--ink-soft);
      font: inherit;
      font-size: 12px;
      line-height: 1.5;
      padding: 4px 10px;
      cursor: pointer;
    }
    .copy:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
    .copy[data-state="done"] { color: var(--add); border-color: var(--add); background: var(--card); }
    .copy[data-state="failed"] { color: var(--del); border-color: var(--del); background: var(--card); }

    .tech { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 14px; }
    .tech summary { cursor: pointer; font-size: 13px; color: var(--ink-soft); }
    .tech summary:hover { color: var(--accent); }
    .tech table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 14px; }
    .tech th {
      text-align: left;
      font-size: 11px;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--ink-soft);
      font-weight: 600;
      padding: 0 10px 8px 0;
      border-bottom: 1px solid var(--line);
    }
    .tech th.numeric { text-align: right; }
    .tech td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    .tech tr:last-child td { border-bottom: none; }

    .empty {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 40px;
      text-align: center;
      color: var(--ink-soft);
    }
    .footer { margin-top: 48px; text-align: center; font-size: 12px; color: var(--ink-soft); }

    @media print {
      body { background: #fff; padding: 0; font-size: 12px; }
      .report-head, .stat, .day { border-color: #d5d9e0; break-inside: avoid; }
      .project { break-inside: avoid-page; }
      .copy { display: none; }
      .tech { display: none; }
      .footer { display: none; }
    }
`;

/**
 * The report is opened straight from disk, where the async clipboard API is not
 * always allowed, so an offscreen selection is kept as a fallback.
 */
const COPY_SCRIPT = `
    function copyBySelection(text) {
      var field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '0';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();

      var copied = false;
      try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
      field.remove();
      return copied;
    }

    document.addEventListener('click', function (event) {
      var button = event.target.closest('.copy');
      if (!button) return;

      var text = button.getAttribute('data-copy') || '';

      function settle(copied) {
        button.textContent = copied ? 'Copied' : 'Failed';
        button.setAttribute('data-state', copied ? 'done' : 'failed');
        setTimeout(function () {
          button.textContent = 'Copy';
          button.removeAttribute('data-state');
        }, 1600);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { settle(true); },
          function () { settle(copyBySelection(text)); },
        );
        return;
      }

      settle(copyBySelection(text));
    });
`;

export function renderReport({ projects, totals, meta }) {
  const period =
    meta.from === meta.to
      ? formatDate(meta.from)
      : `${formatDate(meta.from)} &ndash; ${formatDate(meta.to)}`;

  const generated = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(meta.generatedAt);

  const byline = [
    meta.author ? `Prepared by ${escapeHtml(meta.author)}` : null,
    `Generated ${escapeHtml(generated)}`,
    meta.model ? `Summaries written with ${escapeHtml(meta.model)}` : 'Summaries disabled',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  // Summed here and not in `summarizeTotals`, which runs before the AI pass.
  const estimatedMinutes = projects.reduce(
    (total, project) =>
      total + project.days.reduce((sum, day) => sum + (day.ai?.estimatedMinutes ?? 0), 0),
    0,
  );

  const body = projects.length
    ? projects.map(renderProject).join('')
    : `<div class="empty"><p>No work was recorded for this period.</p></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Work report &middot; ${escapeHtml(meta.from === meta.to ? meta.from : `${meta.from} to ${meta.to}`)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="wrap">
    <header class="report-head">
      <p class="eyebrow">Work report</p>
      <h1>${meta.from === meta.to ? 'Daily activity summary' : 'Activity summary'}</h1>
      <p class="period">${period}</p>
      <p class="byline">${byline}</p>
    </header>

    <div class="stats">${renderStats(totals, estimatedMinutes)}</div>

    ${body}

    <p class="footer">Report generated automatically from the project history.</p>
  </div>
  <script>${COPY_SCRIPT}</script>
</body>
</html>
`;
}
