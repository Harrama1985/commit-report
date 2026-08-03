import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectBranches, groupByProjectAndDate, summarizeTotals } from '../src/git.js';

const commit = (overrides) => ({
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaaa',
  isoDate: '2026-08-03T10:00:00+01:00',
  date: '2026-08-03',
  time: '10:00',
  authorName: 'Dev',
  authorEmail: 'dev@example.com',
  branches: ['main'],
  subject: 'feat: something',
  body: '',
  files: ['src/a.js'],
  insertions: 10,
  deletions: 2,
  ...overrides,
});

test('groupByProjectAndDate skips empty projects and sorts days newest first', () => {
  const projects = groupByProjectAndDate([
    { project: { name: 'quiet', path: '/quiet' }, commits: [] },
    {
      project: { name: 'busy', path: '/busy' },
      commits: [
        commit({ date: '2026-08-01', isoDate: '2026-08-01T09:00:00+01:00' }),
        commit({ date: '2026-08-03' }),
      ],
    },
  ]);

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'busy');
  assert.deepEqual(
    projects[0].days.map((day) => day.date),
    ['2026-08-03', '2026-08-01'],
  );
});

test('groupByProjectAndDate orders commits inside a day chronologically', () => {
  const [project] = groupByProjectAndDate([
    {
      project: { name: 'busy', path: '/busy' },
      commits: [
        commit({ subject: 'later', isoDate: '2026-08-03T17:00:00+01:00' }),
        commit({ subject: 'earlier', isoDate: '2026-08-03T08:00:00+01:00' }),
      ],
    },
  ]);

  assert.deepEqual(
    project.days[0].commits.map((entry) => entry.subject),
    ['earlier', 'later'],
  );
});

test('groupByProjectAndDate ranks projects by commit count', () => {
  const projects = groupByProjectAndDate([
    { project: { name: 'small', path: '/small' }, commits: [commit({})] },
    { project: { name: 'large', path: '/large' }, commits: [commit({}), commit({})] },
  ]);

  assert.deepEqual(
    projects.map((project) => project.name),
    ['large', 'small'],
  );
});

test('collectBranches keeps every branch once, in the order it appears', () => {
  assert.deepEqual(
    collectBranches([
      commit({ branches: ['main'] }),
      commit({ branches: ['feature/login', 'main'] }),
      commit({ branches: [] }),
    ]),
    ['main', 'feature/login'],
  );
});

test('groupByProjectAndDate lists the branches of each day and of the project', () => {
  const [project] = groupByProjectAndDate([
    {
      project: { name: 'busy', path: '/busy' },
      commits: [
        commit({ branches: ['main'] }),
        commit({ subject: 'other', branches: ['feature/login'] }),
        commit({
          date: '2026-08-01',
          isoDate: '2026-08-01T09:00:00+01:00',
          branches: ['hotfix/crash'],
        }),
      ],
    },
  ]);

  assert.deepEqual(project.branches, ['main', 'feature/login', 'hotfix/crash']);
  assert.deepEqual(
    project.days.map((day) => day.branches),
    [['main', 'feature/login'], ['hotfix/crash']],
  );
});

test('summarizeTotals counts unique files per project and unique days', () => {
  const projects = groupByProjectAndDate([
    {
      project: { name: 'one', path: '/one' },
      commits: [
        commit({ files: ['src/a.js'] }),
        commit({ files: ['src/a.js', 'src/b.js'], insertions: 5, deletions: 1 }),
      ],
    },
    {
      project: { name: 'two', path: '/two' },
      commits: [commit({ files: ['src/a.js'], date: '2026-08-02', isoDate: '2026-08-02T10:00:00+01:00' })],
    },
  ]);

  assert.deepEqual(summarizeTotals(projects), {
    projects: 2,
    commits: 3,
    insertions: 25,
    deletions: 5,
    files: 3,
    days: 2,
  });
});
