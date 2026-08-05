# Estimated time per working day

## Goal

Every project/day block in the report shows how long that day of work is worth,
so the client reads the description and the effort behind it in the same place.

## Scope

- The estimate is produced per project/day group, the same unit the AI already
  describes. No per-commit estimate.
- The estimate is shown next to the date of the day.
- The report header gains one total card, `Estimated hours`.
- No estimate is shown when the AI did not write the day. The number only makes
  sense next to a description the client can read, and without the AI there is
  nothing to base it on.

## Not in scope

- The real elapsed time between the first and last commit of a day. Commits are
  often pushed in one batch (eight commits at 16:34) or span an idle day
  (08:23 to 16:42), so the number would be wrong in both directions.

## The estimate itself

`src/ai.js` asks Gemini for `estimatedMinutes` alongside `title` and `summary`,
in the same call and the same JSON schema, so no extra request is made.

Prompt rules for the number:

- Judge the size and the nature of the work from the commit subjects, bodies,
  touched files and line counts. Never from the clock times.
- Assume a developer working with an AI assistant, not alone: the pace is fast.
- Always include testing, review and deployment in the number.
- Do not cap a day at a working day. A day here is a batch of commits, and work
  spread over several days is often pushed at once.

Normalisation in `ai.js`, before the value is stored:

- Accept a finite number or a numeric string; anything else stores `null`.
- Clamp to `[30, 2400]` minutes, then round to the nearest 30 minutes.
- Stored as `day.ai.estimatedMinutes`.

A day that fails on the AI side keeps `day.error` and has no `ai` object at all,
so it carries no estimate. That behaviour already exists and does not change.

## Rendering

`src/report.js`:

- `formatEstimate(minutes)` returns `≈ 30min` under an hour, `≈ 5h` on a whole
  hour, and `≈ 2h30` otherwise.
- The day header prints the estimate right after the date:
  `Monday, 3 August 2026 · ≈ 5h`, the estimate wrapped in `<span class="est">`
  and styled as a small accent pill.
- A day without an estimate prints the date alone.
- The stats grid gains a fifth card, `Estimated hours`, holding the sum of every
  day that has an estimate. The card is left out when the sum is zero.
- The total is summed from `projects` inside `renderReport`, not read from
  `totals`. `summarizeTotals` runs before the AI pass in `src/index.js`, so a
  total computed there would always be zero.
- The estimate stays visible in the print stylesheet.

## Tests

Added to `test/ai.test.js`, which already covers the AI pass and the rendering:

- A day is stored with its estimate rounded to the nearest half hour.
- A non-numeric or out-of-range estimate stores `null` and renders no badge.
- The rendered HTML carries the day badge and the `Estimated hours` card.
- A report whose days have no estimate carries neither badge nor card.

## Documentation

`README.md` gains a line in "How it works" stating that the estimate is written
by the AI together with the description, covers testing and deployment, and is
absent from days the AI did not describe or from a report built with `--no-ai`.
