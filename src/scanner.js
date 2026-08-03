import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { expandHome, isDirectory } from './paths.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'Pods',
  '.venv',
  'venv',
  '__pycache__',
  'Library',
  'Applications',
]);

/**
 * Walks `root` looking for git working copies.
 *
 * A directory that holds a `.git` entry is reported and never descended into,
 * so a monorepo is one project instead of one project per package.
 */
export async function findGitRepos(root, { maxDepth = 2 } = {}) {
  const found = [];
  await walk(root, 0);
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;

  async function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.name === '.git')) {
      found.push({ path: dir, name: path.basename(dir) });
      return;
    }

    const children = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !IGNORED_DIRS.has(entry.name),
    );

    await Promise.all(children.map((entry) => walk(path.join(dir, entry.name), depth + 1)));
  }
}

export async function resolveScanRoot(dir) {
  const resolved = path.resolve(expandHome(dir));
  if (!(await isDirectory(resolved))) {
    throw new Error(`Scan directory not found: ${resolved}`);
  }
  return resolved;
}
