# commit-reports

Turn your local git history into a report a client can actually read.

`commit-report` scans every git project in a folder (`~/Desktop` by default), collects the commits you made on a given date, groups them by day and then by project, and asks OpenAI (GPT) to rewrite each project day as a plain-language description of the work delivered. The result is a single self-contained HTML file you can send, print, or export to PDF.

The technical commit list stays in the report, tucked inside a collapsible section, so you keep the details for yourself while the client reads the summary. Each project header names the branches the commits came from, and every commit row names its own branch and the person who made it.

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

The summaries are written by GPT, so you need an OpenAI key from https://platform.openai.com/api-keys.

```bash
export OPENAI_API_KEY="your-key"
```

Add that line to `~/.zshrc` so it is always available. A terminal that was already open when you edited `~/.zshrc` does not see the new key, so open a new one or run `source ~/.zshrc`.

A `.env` in the folder you run the command from works too, which is handy when you would rather keep the key with the project:

```
OPENAI_API_KEY=your-key
```

A real environment variable always wins over the file. Without a key the report is still generated, but it only lists the raw activity. Use `--no-ai` to skip the AI on purpose.

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
| `--model <name>` | OpenAI model, defaults to `gpt-5.4-mini` |
| `--concurrency <n>` | Parallel AI requests, defaults to `4` |
| `--no-ai` | Skip the summaries and only list the raw activity |
| `--open` | Open the report when it is ready |
| `-q, --quiet` | Print only the output path, handy for scripting |

A date is `YYYY-MM-DD`, `today`, `yesterday`, or `-N` for N days ago.

## How it works

1. **Scan** — walks `--dir` up to `--depth` levels and stops at any folder containing `.git`, so a monorepo counts as one project.
2. **Collect** — runs `git log --all` for the day window, filtered to your email, without merge commits. Every commit keeps the branch it was read from. Commits duplicated across branches by a rebase or cherry-pick are counted once, and the copy that is kept lists all the branches they were found on.
3. **Group** — organises everything by day, then by project inside that day, and gathers the branches touched at each level.
4. **Describe** — sends each project/day batch to GPT, including the lines that changed, and asks for a headline and one dense paragraph of at most two lines, never a list. The description stays in everyday words for an ordinary client: what a person can now do or what was fixed, not how the code was written. The estimate is read from those changes, never from the times on the commits. It counts time for reading and correcting the work, whether that work was written by hand or drafted with an assistant, and it includes testing, review and deployment. It is shown next to the date and totalled at the top of the report, and it is absent from any day the AI did not describe, so `--no-ai` produces a report with no estimates at all. Each description has a copy button in the report.
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
  apiKey: process.env.OPENAI_API_KEY,
});
```

## Privacy

Commit subjects, commit bodies, changed file paths, and the lines that changed are sent to the OpenAI API. A long change is shortened, and lockfiles and binary files are left out. The rest of each file is never sent. Use `--no-ai` for projects where even that is too much.

## License

MIT
