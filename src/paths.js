import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Expands a leading `~`, using the real home directory on every platform. */
export function expandHome(target) {
  if (target === '~') return homedir();
  if (target.startsWith('~/') || target.startsWith('~\\')) {
    return path.join(homedir(), target.slice(2));
  }
  return target;
}

/**
 * The folder scanned when no `--dir` is given.
 *
 * A Windows account with OneDrive backup enabled has its Desktop under
 * `OneDrive`, so the plain path is checked first and that one is the fallback.
 */
export async function defaultScanDir() {
  const home = homedir();
  const candidates = [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop')];

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate;
  }

  return candidates[0];
}
