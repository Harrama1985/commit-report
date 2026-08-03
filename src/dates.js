const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar day as YYYY-MM-DD, not the UTC day `toISOString` would give. */
export function toIsoDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function today() {
  return toIsoDay(new Date());
}

function shiftDays(isoDay, amount) {
  const date = new Date(`${isoDay}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return toIsoDay(date);
}

/**
 * Accepts an ISO day, `today`, `yesterday`, or a `-N` days offset.
 */
export function parseDay(input, label = 'date') {
  const value = String(input).trim().toLowerCase();

  if (value === 'today') return today();
  if (value === 'yesterday') return shiftDays(today(), -1);

  const offset = value.match(/^-(\d+)$/);
  if (offset) return shiftDays(today(), -Number(offset[1]));

  if (!ISO_DAY.test(value)) {
    throw new Error(
      `Invalid ${label}: "${input}". Use YYYY-MM-DD, "today", "yesterday" or "-3" for three days ago.`,
    );
  }

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()) || toIsoDay(date) !== value) {
    throw new Error(`Invalid ${label}: "${input}" is not a real calendar date.`);
  }

  return value;
}

/** Resolves the positional date plus --date/--from/--to/--days into a window. */
export function resolveRange({ date, from, to, days }) {
  if (days !== undefined) {
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid --days: "${days}". Use a whole number of days, for example --days 7.`);
    }
    const end = to ? parseDay(to, '--to') : today();
    return { from: shiftDays(end, -(count - 1)), to: end };
  }

  if (from || to) {
    const start = from ? parseDay(from, '--from') : parseDay(to, '--to');
    const end = to ? parseDay(to, '--to') : today();
    if (start > end) throw new Error(`Invalid range: --from (${start}) is after --to (${end}).`);
    return { from: start, to: end };
  }

  const single = date ? parseDay(date) : today();
  return { from: single, to: single };
}
