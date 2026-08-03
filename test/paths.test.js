import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { defaultScanDir, expandHome, isDirectory } from '../src/paths.js';

test('expandHome resolves a leading tilde to the real home directory', () => {
  assert.equal(expandHome('~'), homedir());
  assert.equal(expandHome('~/Desktop'), path.join(homedir(), 'Desktop'));
  assert.equal(expandHome('~\\Desktop'), path.join(homedir(), 'Desktop'));
});

test('expandHome leaves everything else untouched', () => {
  assert.equal(expandHome('/tmp/projects'), '/tmp/projects');
  assert.equal(expandHome('./projects'), './projects');
  assert.equal(expandHome('~backup'), '~backup');
});

test('isDirectory tells folders from missing paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'commit-reports-'));
  assert.equal(await isDirectory(dir), true);
  assert.equal(await isDirectory(path.join(dir, 'nope')), false);
});

test('defaultScanDir returns a Desktop under the home directory', async () => {
  const resolved = await defaultScanDir();
  assert.equal(path.basename(resolved), 'Desktop');
  assert.equal(resolved.startsWith(homedir()), true);
});
