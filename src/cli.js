#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { DEFAULT_MODEL, buildReport } from './index.js';
import { resolveRange } from './dates.js';
import { getGitEmail } from './git.js';
import { defaultScanDir, expandHome } from './paths.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\u001B[${code}m${text}\u001B[0m` : text);
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');
const cyan = paint('36');

const OPTIONS = {
  date: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  days: { type: 'string' },
  dir: { type: 'string' },
  out: { type: 'string' },
  author: { type: 'string' },
  all: { type: 'boolean', default: false },
  merges: { type: 'boolean', default: false },
  depth: { type: 'string' },
  model: { type: 'string' },
  concurrency: { type: 'string' },
  'no-ai': { type: 'boolean', default: false },
  open: { type: 'boolean', default: false },
  quiet: { type: 'boolean', short: 'q', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

function helpText() {
  return `
${bold('commit-report')} - turn your git history into a client-friendly HTML report

${bold('USAGE')}
  commit-report [date] [options]

${bold('DATE')}
  A date is ${cyan('YYYY-MM-DD')}, ${cyan('today')}, ${cyan('yesterday')} or ${cyan('-N')} for N days ago.
  Defaults to today when nothing is given.

${bold('OPTIONS')}
  --date <date>          Single day to report on (same as the positional date)
  --from <date>          Start of a range
  --to <date>            End of a range (defaults to today)
  --days <n>             Last n days, ending today or at --to
  --dir <path>           Folder to scan for projects (default: the Desktop in your home folder)
  --depth <n>            How deep to look for projects inside --dir (default: 2)
  --out <path>           Output file or folder (default: ./work-report-<date>.html)
  --author <email>       Filter by author (default: your git config user.email)
  --all                  Include commits from every author
  --merges               Include merge commits
  --model <name>         Google AI model (default: ${DEFAULT_MODEL})
  --concurrency <n>      Parallel AI requests (default: 4)
  --no-ai                Skip the AI summaries and only list the raw activity
  --open                 Open the report when it is ready
  -q, --quiet            Only print the output path
  -h, --help             Show this help
  -v, --version          Show the version

${bold('ENVIRONMENT')}
  ${cyan('GEMINI_API_KEY')}         Google AI Studio key, required for the summaries
                         Get one at https://aistudio.google.com/apikey

${bold('EXAMPLES')}
  commit-report
  commit-report 2026-08-03
  commit-report yesterday --open
  commit-report --days 7 --out ~/Desktop/reports
  commit-report --from 2026-07-01 --to 2026-07-31 --all
`;
}

async function readVersion() {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    return JSON.parse(await readFile(pkgPath, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function parseCount(value, flag, fallback) {
  if (value === undefined) return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Invalid ${flag}: "${value}". Use a whole number of 1 or more.`);
  }
  return count;
}

async function resolveOutPath(out, from, to) {
  const name = from === to ? `work-report-${from}.html` : `work-report-${from}_to_${to}.html`;
  if (!out) return path.resolve(process.cwd(), name);

  const resolved = path.resolve(expandHome(out));

  if (resolved.toLowerCase().endsWith('.html')) return resolved;
  return path.join(resolved, name);
}

function progressLine(text) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r\u001B[2K${text}`);
}

/**
 * `start` is a cmd.exe builtin rather than a program, so Windows needs the shell
 * in front of it. Its first quoted argument is a window title, hence the empty
 * one before the path.
 */
function openFile(target, log) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [target]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', target]]
        : ['xdg-open', [target]];

  execFile(command, args, (error) => {
    if (error) log(`${yellow('!')} Could not open the report automatically (${command}).`);
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    options: OPTIONS,
    allowPositionals: true,
    args: process.argv.slice(2),
  });

  if (values.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  if (values.version) {
    process.stdout.write(`${await readVersion()}\n`);
    return;
  }

  if (positionals.length > 1) {
    throw new Error(`Too many arguments: ${positionals.join(' ')}. Only one date is expected.`);
  }

  const { from, to } = resolveRange({
    date: positionals[0] ?? values.date,
    from: values.from,
    to: values.to,
    days: values.days,
  });

  const dir = values.dir ? expandHome(values.dir) : await defaultScanDir();
  const author = values.all ? null : (values.author ?? (await getGitEmail()));
  const apiKey = values['no-ai'] ? null : (process.env.GEMINI_API_KEY?.trim() || null);
  const quiet = values.quiet;
  const log = (text) => {
    if (!quiet) process.stdout.write(`${text}\n`);
  };

  if (!values.all && !author) {
    throw new Error(
      'Could not determine the commit author. Set it with --author <email>, or use --all for every author.',
    );
  }

  if (!values['no-ai'] && !apiKey) {
    log(
      `${yellow('!')} GEMINI_API_KEY is not set, so the report will list the raw activity without plain-language summaries.\n  ${dim('Get a key at https://aistudio.google.com/apikey then run: export GEMINI_API_KEY=...')}\n  ${dim('Use --no-ai to hide this warning.')}`,
    );
  }

  const period = from === to ? from : `${from} to ${to}`;
  log(`${bold('Work report')} ${dim('for')} ${cyan(period)}`);
  log(`${dim('Scanning')} ${dir}${author ? ` ${dim('as')} ${author}` : ` ${dim('(all authors)')}`}`);

  const result = await buildReport({
    dir,
    from,
    to,
    author,
    includeMerges: values.merges,
    maxDepth: parseCount(values.depth, '--depth', 2),
    apiKey,
    model: values.model ?? DEFAULT_MODEL,
    concurrency: parseCount(values.concurrency, '--concurrency', 4),
    onEvent: (event) => {
      if (quiet) return;
      if (event.type === 'scan:done') {
        log(`${dim('Found')} ${event.count} ${dim('projects')}`);
      }
      if (event.type === 'ai:progress') {
        progressLine(
          `${dim('Writing summaries')} ${event.done}/${event.total} ${dim('·')} ${event.project} ${dim(event.date)}`,
        );
        if (event.done === event.total) progressLine('');
      }
    },
  });

  const { totals, failures } = result;

  if (totals.commits === 0) {
    log(`${yellow('!')} No commits found for ${period}.`);
    log(dim('  Try another date, a wider range with --days, or --all to include every author.'));
    return;
  }

  const outPath = await resolveOutPath(values.out, from, to);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, result.html, 'utf8');

  log(
    `${green('✓')} ${totals.commits} ${totals.commits === 1 ? 'change' : 'changes'} across ${totals.projects} ${totals.projects === 1 ? 'project' : 'projects'} and ${totals.days} ${totals.days === 1 ? 'day' : 'days'}`,
  );

  for (const failure of failures) {
    log(`${yellow('!')} ${failure.project} ${dim(failure.date)}: ${failure.error}`);
  }

  if (quiet) process.stdout.write(`${outPath}\n`);
  else log(`${bold('Report')} ${outPath}`);

  if (values.open) {
    openFile(outPath, log);
  }
}

main().catch((error) => {
  process.stderr.write(`${red('✗')} ${error.message}\n`);
  process.exitCode = 1;
});
