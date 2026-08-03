import { describeDays, DEFAULT_MODEL } from './ai.js';
import { getCommits, groupByProjectAndDate, summarizeTotals } from './git.js';
import { renderReport } from './report.js';
import { findGitRepos, resolveScanRoot } from './scanner.js';

export { DEFAULT_MODEL, renderReport, findGitRepos, resolveScanRoot };

/**
 * Collects the commits of every project under `dir` for the given window and
 * turns them into a client-facing HTML report.
 *
 * Set `apiKey` to null to skip the AI pass and keep only the raw activity.
 */
export async function buildReport({
  dir,
  from,
  to,
  author = null,
  includeMerges = false,
  maxDepth = 2,
  apiKey = null,
  model = DEFAULT_MODEL,
  concurrency = 4,
  timeout = 60_000,
  onEvent = () => {},
}) {
  const root = await resolveScanRoot(dir);

  onEvent({ type: 'scan:start', root });
  const repos = await findGitRepos(root, { maxDepth });
  onEvent({ type: 'scan:done', count: repos.length });

  const entries = await Promise.all(
    repos.map(async (repo) => {
      const commits = await getCommits(repo, { from, to, author, includeMerges });
      onEvent({ type: 'repo:done', name: repo.name, commits: commits.length });
      return { project: repo, commits };
    }),
  );

  const projects = groupByProjectAndDate(entries);
  const totals = summarizeTotals(projects);

  let usedModel = null;

  if (apiKey && projects.length > 0) {
    onEvent({ type: 'ai:start', groups: totals.projects, days: totals.days });
    const result = await describeDays(projects, {
      apiKey,
      model,
      concurrency,
      timeout,
      onProgress: (progress) => onEvent({ type: 'ai:progress', ...progress }),
    });
    usedModel = result.model;
    onEvent({ type: 'ai:done', total: result.total, model: usedModel });
  }

  const failures = projects.flatMap((project) =>
    project.days.filter((day) => day.error).map((day) => ({
      project: project.name,
      date: day.date,
      error: day.error,
    })),
  );

  const html = renderReport({
    projects,
    totals,
    meta: { from, to, author, model: usedModel, generatedAt: new Date(), root },
  });

  return { html, projects, totals, failures, scanned: repos.length, model: usedModel };
}
