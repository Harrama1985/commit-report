import { readFileSync } from 'node:fs';
import path from 'node:path';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** Drops one matching pair of surrounding quotes, the way a shell would. */
function unquote(value) {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first) && trimmed.length > 1) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
}

export function parseEnv(text) {
  const values = {};

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = LINE.exec(line);
    if (match) values[match[1]] = unquote(match[2]);
  }

  return values;
}

/**
 * Reads a `.env` next to where the command was run, so a key kept with the
 * project works without exporting it first. A real environment variable always
 * wins, and a missing or unreadable file is simply no configuration at all.
 */
export function loadEnv(dir = process.cwd(), env = process.env) {
  let text;

  try {
    text = readFileSync(path.join(dir, '.env'), 'utf8');
  } catch {
    return {};
  }

  const values = parseEnv(text);

  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined) env[key] = value;
  }

  return values;
}
