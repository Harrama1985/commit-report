import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadEnv, parseEnv } from '../src/env.js';

const tempDir = () => mkdtemp(path.join(tmpdir(), 'commit-reports-env-'));

test('parseEnv reads plain, quoted and exported lines', () => {
  const values = parseEnv(
    [
      '# a comment',
      '',
      'OPENAI_API_KEY=sk-plain',
      'QUOTED="sk-quoted"',
      "SINGLE='sk-single'",
      'export EXPORTED=sk-exported',
      '  SPACED = sk-spaced  ',
    ].join('\n'),
  );

  assert.deepEqual(values, {
    OPENAI_API_KEY: 'sk-plain',
    QUOTED: 'sk-quoted',
    SINGLE: 'sk-single',
    EXPORTED: 'sk-exported',
    SPACED: 'sk-spaced',
  });
});

test('parseEnv keeps a value that contains an equals sign', () => {
  assert.equal(parseEnv('KEY=a=b=c').KEY, 'a=b=c');
});

test('loadEnv fills in a key that the environment does not have', async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, '.env'), 'OPENAI_API_KEY=sk-from-file\n');

  const env = {};
  loadEnv(dir, env);

  assert.equal(env.OPENAI_API_KEY, 'sk-from-file');
});

test('loadEnv never overrides a real environment variable', async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, '.env'), 'OPENAI_API_KEY=sk-from-file\n');

  const env = { OPENAI_API_KEY: 'sk-from-shell' };
  loadEnv(dir, env);

  assert.equal(env.OPENAI_API_KEY, 'sk-from-shell');
});

test('loadEnv is a no-op when there is no .env', async () => {
  const dir = await tempDir();
  const env = {};

  assert.deepEqual(loadEnv(dir, env), {});
  assert.deepEqual(env, {});
});
