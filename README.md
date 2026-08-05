# commit-reports

Turn your local git history into a report a client can actually read.

`commit-report` scans every git project in a folder (`~/Desktop` by default), collects the commits you made on a given date, groups them by project and by day, and asks Google AI Studio (Gemini) to rewrite each day as a plain-language description of the work delivered. The result is a single self-contained HTML file you can send, print, or export to PDF.

The technical commit list stays in the report, tucked inside a collapsible section, so you keep the details for yourself while the client reads the summary. Each project header names the branches the commits came from, and every commit row names its own branch.

## Install

```bash
npm install -g commit-reports
```

Or from a local clone:

```bash
npm install -g .
```

Requires Node.js 18.17 or newer and `git` on your PATH. Works on macOS, Linux and Windows.

On Windows the default scan folder is `%USERPROFILE%\Desktop`, or `%USERPROFILE%\OneDrive\Desktop` when OneDrive backup is on.

## API key

The summaries are written by Gemini, so you need a free Google AI Studio key from https://aistudio.google.com/apikey.

```bash
export GEMINI_API_KEY="your-key"
```

Add that line to `~/.zshrc` so it is always available. Without a key the report is still generated, but it only lists the raw activity. Use `--no-ai` to skip the AI on purpose.

## Usage

```bash
commit-report                       # today
commit-report 2026-08-03            # a specific day
commit-report yesterday --open      # yesterday, then open it
commit-report -3                    # three days ago
commit-report --days 7              # the last seven days
commit-report --from 2026-07-01 --to 2026-07-31
```

The report is written to `./work-report-<date>.html` unless you pass `--out`.

### Options

| Option | Description |
| --- | --- |
| `--date <date>` | Single day to report on, same as the positional date |
| `--from <date>` | Start of a range |
| `--to <date>` | End of a range, defaults to today |
| `--days <n>` | Last n days, ending today or at `--to` |
| `--dir <path>` | Folder to scan for projects, defaults to the Desktop in your home folder |
| `--depth <n>` | How deep to look for projects inside `--dir`, defaults to `2` |
| `--out <path>` | Output file or folder |
| `--author <email>` | Filter by author, defaults to your `git config user.email` |
| `--all` | Include commits from every author |
| `--merges` | Include merge commits |
| `--model <name>` | Google AI model, defaults to `gemini-3.6-flash` |
| `--concurrency <n>` | Parallel AI requests, defaults to `4` |
| `--no-ai` | Skip the summaries and only list the raw activity |
| `--open` | Open the report when it is ready |
| `-q, --quiet` | Print only the output path, handy for scripting |

A date is `YYYY-MM-DD`, `today`, `yesterday`, or `-N` for N days ago.

## How it works

1. **Scan** — walks `--dir` up to `--depth` levels and stops at any folder containing `.git`, so a monorepo counts as one project.
2. **Collect** — runs `git log --all` for the day window, filtered to your email, without merge commits. Every commit keeps the branch it was read from. Commits duplicated across branches by a rebase or cherry-pick are counted once, and the copy that is kept lists all the branches they were found on.
3. **Group** — organises everything by project, then by day, and gathers the branches touched at each level.
4. **Describe** — sends each project/day batch to Gemini and asks for a headline, one dense paragraph, at most two lines and never a list, covering everything delivered that day in non-technical English, and an estimate of the work that day represents. The estimate is read from the changes themselves, never from the times on the commits, assumes a developer working with an AI assistant, and includes testing, review and deployment. It is shown next to the date and totalled at the top of the report, and it is absent from any day the AI did not describe, so `--no-ai` produces a report with no estimates at all. Each description has a copy button in the report.
5. **Render** — writes one HTML file with no external assets and a print stylesheet, so `Cmd+P → Save as PDF` gives a clean document.

If a single day fails on the AI side, that day falls back to the raw list and the rest of the report is still produced.

## Programmatic use

```js
import { buildReport } from 'commit-reports';

const { html, totals } = await buildReport({
  dir: '/Users/me/Desktop',
  from: '2026-08-03',
  to: '2026-08-03',
  author: 'me@example.com',
  apiKey: process.env.GEMINI_API_KEY,
});
```

## Privacy

Commit subjects, commit bodies, and changed file paths are sent to the Google AI Studio API. File contents and diffs are never sent. Use `--no-ai` for projects where even that is too much.

## License

MIT
