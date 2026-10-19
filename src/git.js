import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';
const LOG_FORMAT = `${RECORD_SEP}%H${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%S${FIELD_SEP}%s${FIELD_SEP}%b${FIELD_SEP}`;

const MAX_BUFFER = 32 * 1024 * 1024;

/** Enough of a diff to see the change, without sending a whole generated file. */
const PATCH_LIMIT = 2500;

const OMITTED_PATH =
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock)$/i;

async function git(cwd, args) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

export async function getGitEmail() {
  try {
    return (await git(process.cwd(), ['config', '--get', 'user.email'])).trim() || null;
  } catch {
    return null;
  }
}

/** `git log --numstat` emits "<added>\t<deleted>\t<path>" lines after each record. */
function parseNumstat(blob) {
  const files = [];
  let insertions = 0;
  let deletions = 0;

  for (const line of blob.split('\n')) {
    const parts = line.trim().split('\t');
    if (parts.length < 3) continue;
    const [added, deleted, ...rest] = parts;
    const file = rest.join('\t');
    if (!file) continue;
    files.push(file);
    if (added !== '-') insertions += Number(added) || 0;
    if (deleted !== '-') deletions += Number(deleted) || 0;
  }

  return { files, insertions, deletions };
}

/** `--patch` is appended after the numstat block. */
function splitStatAndPatch(blob) {
  const at = blob.search(/\n(?=diff --git |Binary files )/);
  if (at === -1) return { stat: blob, patch: '' };
  return { stat: blob.slice(0, at), patch: blob.slice(at + 1) };
}

/**
 * Keeps the source diff and drops lockfiles and binaries. A long change is cut
 * so one file cannot crowd out the rest of the day.
 */
function selectChangedLines(patch) {
  const chunks = patch
    .split(/^(?=diff --git |Binary files )/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const kept = chunks.filter((chunk) => {
    if (chunk.startsWith('Binary files ')) return false;
    const file = chunk.match(/^diff --git a\/(.+) b\//)?.[1] ?? '';
    return !OMITTED_PATH.test(file);
  });

  const text = kept.join('\n\n');
  if (text.length <= PATCH_LIMIT) return text;
  return `${text.slice(0, PATCH_LIMIT).trimEnd()}\n…`;
}

/**
 * `%S` reports the whole ref a commit was reached from, such as
 * `refs/heads/main` or `refs/remotes/origin/main`. Only the tail reads as a
 * branch name.
 */
function branchName(ref) {
  const name = (ref ?? '').trim();
  if (!name) return null;
  return name.replace(/^refs\/(heads|remotes|tags)\//, '').replace(/^refs\//, '') || null;
}

/** Adds the names of `from` that `into` does not carry yet, keeping the order. */
function mergeBranches(into, from) {
  for (const branch of from) {
    if (!into.includes(branch)) into.push(branch);
  }
}

/**
 * Cherry-picks and rebases leave the same work on several branches under
 * different hashes, and `--all` walks all of them. Same author timestamp plus
 * same subject means the same change, so only the first copy is kept, widened
 * with the branches its twins were found on.
 */
function dedupe(commits) {
  const kept = new Map();

  for (const commit of commits) {
    const signature = `${commit.isoDate}|${commit.subject}`;
    const first = kept.get(signature);
    if (first) mergeBranches(first.branches, commit.branches);
    else kept.set(signature, commit);
  }

  return [...kept.values()];
}

function parseLog(stdout) {
  const commits = stdout
    .split(RECORD_SEP)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash, isoDate, authorName, authorEmail, ref, subject, body, statBlob = ''] =
        chunk.split(FIELD_SEP);
      const { stat, patch } = splitStatAndPatch(statBlob);
      const { files, insertions, deletions } = parseNumstat(stat);
      const branch = branchName(ref);

      return {
        hash,
        shortHash: hash.slice(0, 8),
        isoDate,
        date: isoDate.slice(0, 10),
        time: isoDate.slice(11, 16),
        authorName,
        authorEmail,
        branches: branch ? [branch] : [],
        subject: subject.trim(),
        body: body.trim(),
        files,
        insertions,
        deletions,
        patch: selectChangedLines(patch),
      };
    });

  return dedupe(commits);
}

/**
 * Reads commits from every branch of `repo` inside the [from, to] day window.
 * Returns [] for anything that is not a usable repository.
 */
export async function getCommits(repo, { from, to, author, includeMerges = false }) {
  const args = [
    'log',
    '--all',
    '--source',
    `--since=${from} 00:00:00`,
    `--until=${to} 23:59:59`,
    '--date=iso-strict',
    `--pretty=format:${LOG_FORMAT}`,
    '--numstat',
    '--patch',
  ];

  if (!includeMerges) args.push('--no-merges');
  if (author) args.push(`--author=${author}`);

  try {
    return parseLog(await git(repo.path, args));
  } catch {
    return [];
  }
}

/** The branches a set of commits was found on, in the order they first appear. */
export function collectBranches(commits) {
  const branches = [];
  for (const commit of commits) mergeBranches(branches, commit.branches ?? []);
  return branches;
}

/** Shapes flat commit lists into `[{ project, days: [{ date, commits }] }]`. */
export function groupByProjectAndDate(entries) {
  const projects = [];

  for (const { project, commits } of entries) {
    if (commits.length === 0) continue;

    const byDate = new Map();
    for (const commit of commits) {
      if (!byDate.has(commit.date)) byDate.set(commit.date, []);
      byDate.get(commit.date).push(commit);
    }

    const days = [...byDate.entries()]
      .map(([date, list]) => {
        const sorted = list.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
        return { date, commits: sorted, branches: collectBranches(sorted) };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    projects.push({
      name: project.name,
      path: project.path,
      branches: collectBranches(commits),
      commitCount: commits.length,
      days,
    });
  }

  return projects.sort(
    (a, b) => b.commitCount - a.commitCount || a.name.localeCompare(b.name),
  );
}

export function summarizeTotals(projects) {
  let commits = 0;
  let insertions = 0;
  let deletions = 0;
  const files = new Set();
  const dates = new Set();

  for (const project of projects) {
    for (const day of project.days) {
      dates.add(day.date);
      for (const commit of day.commits) {
        commits += 1;
        insertions += commit.insertions;
        deletions += commit.deletions;
        for (const file of commit.files) files.add(`${project.name}:${file}`);
      }
    }
  }

  return {
    projects: projects.length,
    commits,
    insertions,
    deletions,
    files: files.size,
    days: dates.size,
  };
}
