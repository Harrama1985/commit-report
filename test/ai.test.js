import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';

import { describeDays } from '../src/ai.js';
import { renderReport } from '../src/report.js';
import { groupByProjectAndDate, summarizeTotals } from '../src/git.js';

const commit = (subject, files = ['src/a.js']) => ({
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaaa',
  isoDate: '2026-08-03T10:00:00+01:00',
  date: '2026-08-03',
  time: '10:00',
  authorName: 'Dev',
  authorEmail: 'dev@example.com',
  subject,
  body: '',
  files,
  insertions: 4,
  deletions: 1,
});

const sampleProjects = () =>
  groupByProjectAndDate([
    {
      project: { name: 'shop-fe', path: '/shop-fe' },
      commits: [commit('feat(cart): add promo code field'), commit('fix(cart): total rounding')],
    },
  ]);

/** Spins up a stand-in for the OpenAI endpoint and returns its base URL. */
async function mockApi(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const entry = { url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') };
      requests.push(entry);
      handler(entry, res, requests.length);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const jsonReply = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const candidate = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });

const servers = [];
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

async function startMock(handler) {
  const server = await mockApi(handler);
  servers.push(server);
  return server;
}

test('describeDays sends the commits and stores the summary on the day', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: 'Discount codes in the basket',
          summary: 'Customers can now enter a discount code before paying.',
        }),
      ),
    );
  });

  const projects = sampleProjects();
  const result = await describeDays(projects, {
    apiKey: 'test-key',
    model: 'gpt-5.4-mini',
    baseUrl: api.baseUrl,
  });

  assert.equal(result.total, 1);
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].headers.authorization, 'Bearer test-key');
  assert.match(api.requests[0].url, /\/v1\/chat\/completions$/);
  assert.equal(api.requests[0].body.model, 'gpt-5.4-mini');

  const prompt = api.requests[0].body.messages[1].content;
  assert.match(prompt, /shop-fe/);
  assert.match(prompt, /promo code field/);
  assert.match(prompt, /total rounding/);
  assert.equal(api.requests[0].body.response_format.type, 'json_schema');

  const day = projects[0].days[0];
  assert.equal(day.title, undefined);
  assert.equal(day.ai.title, 'Discount codes in the basket');
  assert.equal(day.ai.summary, 'Customers can now enter a discount code before paying.');
  assert.equal(day.error, undefined);
});

test('describeDays keeps the summary within two lines by dropping whole sentences', async () => {
  const long = [
    'The booking page was rebuilt so customers can pick their seats before paying.',
    'The payment step now accepts three more card types.',
    'A confirmation email is sent right after a booking is made.',
    'The search results load faster on mobile phones.',
    'The footer links were corrected across every page.',
    'The contact form now warns people when an address is missing.',
  ].join(' ');

  assert.ok(long.length > 200, 'the fixture must exceed the limit for this test to mean anything');

  const api = await startMock((entry, res) => {
    jsonReply(res, 200, candidate(JSON.stringify({ title: 'Booking work', summary: long })));
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  const { summary } = projects[0].days[0].ai;
  assert.ok(summary.length <= 200, `summary was ${summary.length} characters`);
  assert.match(summary, /^The booking page was rebuilt/);
  assert.match(summary, /[.!?]$/, 'the summary should end on a finished sentence');
  assert.ok(!summary.includes('footer links'), 'the trailing sentences should be dropped');
});

test('describeDays clamps a single runaway sentence on a word boundary', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: 'T',
          summary: `The booking page ${'was updated and improved '.repeat(20)}today`,
        }),
      ),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  const { summary } = projects[0].days[0].ai;
  assert.ok(summary.length <= 200, `summary was ${summary.length} characters`);
  assert.match(summary, /\u2026$/);
  assert.ok(!summary.includes('  '), 'no double spaces should survive the cut');
});

test('describeDays folds a list answer back into one paragraph', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: 'T',
          summary: '- A discount code field in the basket\n- Correct totals after a discount',
        }),
      ),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  assert.equal(
    projects[0].days[0].ai.summary,
    'A discount code field in the basket. Correct totals after a discount',
  );
});

test('describeDays leaves a short summary untouched', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: 'Basket work',
          summary: 'Customers can now enter a discount code before paying.',
        }),
      ),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  assert.equal(
    projects[0].days[0].ai.summary,
    'Customers can now enter a discount code before paying.',
  );
});

test('describeDays survives an answer wrapped in a code fence', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate('```json\n{"title":"Basket work","summary":"Small fixes."}\n```'),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  assert.equal(projects[0].days[0].ai.title, 'Basket work');
});

test('describeDays falls back to another model on 404', async () => {
  const api = await startMock((entry, res, count) => {
    if (count === 1) return jsonReply(res, 404, { error: { message: 'model not found' } });
    jsonReply(res, 200, candidate('{"title":"T","summary":"S"}'));
  });

  const projects = sampleProjects();
  const result = await describeDays(projects, {
    apiKey: 'k',
    model: 'gpt-does-not-exist',
    baseUrl: api.baseUrl,
  });

  assert.equal(result.model, 'gpt-5-mini');
  assert.equal(projects[0].days[0].ai.title, 'T');
});

test('describeDays records the failure on the day instead of throwing', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(res, 400, { error: { message: 'bad request' } });
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  assert.equal(projects[0].days[0].ai, undefined);
  assert.match(projects[0].days[0].error, /400/);
});

test('describeDays stores the estimate rounded to the nearest half hour', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes: 200 })),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  assert.equal(projects[0].days[0].ai.estimatedMinutes, 210);
});

test('describeDays keeps the estimate inside its bounds', async () => {
  const api = await startMock((entry, res, count) => {
    const estimatedMinutes = count === 1 ? 4 : 99_999;
    jsonReply(res, 200, candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes })));
  });

  const small = sampleProjects();
  await describeDays(small, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(small[0].days[0].ai.estimatedMinutes, 30);

  const huge = sampleProjects();
  await describeDays(huge, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(huge[0].days[0].ai.estimatedMinutes, 2400);
});

test('describeDays drops an estimate that is not a usable number', async () => {
  const api = await startMock((entry, res, count) => {
    const estimatedMinutes = count === 1 ? 'about a day' : -60;
    jsonReply(res, 200, candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes })));
  });

  const words = sampleProjects();
  await describeDays(words, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(words[0].days[0].ai.estimatedMinutes, null);
  assert.equal(words[0].days[0].ai.summary, 'S', 'the description must survive a bad estimate');

  const negative = sampleProjects();
  await describeDays(negative, { apiKey: 'k', baseUrl: api.baseUrl });
  assert.equal(negative[0].days[0].ai.estimatedMinutes, null);
});

test('describeDays asks the model for the estimate', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes: 60 })),
    );
  });

  await describeDays(sampleProjects(), { apiKey: 'k', baseUrl: api.baseUrl });

  const { schema } = api.requests[0].body.response_format.json_schema;
  assert.equal(schema.properties.estimatedMinutes.type, 'integer');
  assert.ok(schema.required.includes('estimatedMinutes'));

  const system = api.requests[0].body.messages[0].content;
  assert.match(system, /estimatedMinutes/);
  assert.match(system, /deployment/i);
  assert.match(system, /reads that code and reworks/i);
  assert.doesNotMatch(system, /pace is fast/);
  assert.match(system, /ordinary client/i);
  assert.match(system, /Do not describe them/i);
});

test('describeDays shows the model the lines that changed', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(res, 200, candidate(JSON.stringify({ title: 'T', summary: 'S', estimatedMinutes: 60 })));
  });

  const projects = sampleProjects();
  projects[0].days[0].commits[0].patch = 'diff --git a/src/cart.js b/src/cart.js\n+discount code field';

  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  const prompt = api.requests[0].body.messages[1].content;
  assert.match(prompt, /Changed lines:/);
  assert.match(prompt, /discount code field/);
});

test('the rendered report contains the summary and escapes hostile text', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: '<script>alert(1)</script>',
          summary: 'Customers can now enter a discount code.',
        }),
      ),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  const html = renderReport({
    projects,
    totals: summarizeTotals(projects),
    meta: {
      from: '2026-08-03',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: 'gpt-5.4-mini',
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  assert.match(html, /Customers can now enter a discount code\./);
  assert.match(
    html,
    /<button class="copy"[^>]*data-copy="Customers can now enter a discount code\."/,
    'the description should come with a copy button carrying its text',
  );
  assert.ok(!html.includes('<ul class="highlights">'), 'the description must not be a list');
  assert.match(html, /Monday, 3 August 2026/);
  assert.match(html, /Shop FE/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('the technical detail names the author of each commit', () => {
  const html = renderReport({
    projects: sampleProjects(),
    totals: summarizeTotals(sampleProjects()),
    meta: {
      from: '2026-08-03',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: null,
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  assert.match(html, /<th>Author<\/th>/);
  assert.match(html, /<td class="muted">Dev<\/td>/);
});

test('the rendered report shows the day estimate and the total', async () => {
  const api = await startMock((entry, res) => {
    jsonReply(
      res,
      200,
      candidate(
        JSON.stringify({
          title: 'Basket work',
          summary: 'Customers can now enter a discount code.',
          estimatedMinutes: 150,
        }),
      ),
    );
  });

  const projects = sampleProjects();
  await describeDays(projects, { apiKey: 'k', baseUrl: api.baseUrl });

  const html = renderReport({
    projects,
    totals: summarizeTotals(projects),
    meta: {
      from: '2026-08-03',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: 'gpt-5.4-mini',
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  assert.match(html, /<span class="est">\u2248 2h30<\/span>/);
  assert.match(html, /Estimated hours/);
  assert.match(html, /<span class="stat-value">\u2248 2h30<\/span>/);
});

test('the report groups by date, then by project inside each date', () => {
  const projects = groupByProjectAndDate([
    {
      project: { name: 'shop-fe', path: '/shop-fe' },
      commits: [
        { ...commit('promo field'), isoDate: '2026-08-03T09:00:00+01:00' },
        { ...commit('rounding fix'), isoDate: '2026-08-03T10:00:00+01:00' },
        {
          ...commit('early shop'),
          date: '2026-08-01',
          isoDate: '2026-08-01T10:00:00+01:00',
        },
      ],
    },
    {
      project: { name: 'api-be', path: '/api-be' },
      commits: [{ ...commit('api discount'), isoDate: '2026-08-03T11:00:00+01:00' }],
    },
  ]);

  const html = renderReport({
    projects,
    totals: summarizeTotals(projects),
    meta: {
      from: '2026-08-01',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: null,
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  const newer = html.indexOf('<h2>Monday, 3 August 2026</h2>');
  const older = html.indexOf('<h2>Saturday, 1 August 2026</h2>');
  const shop = html.indexOf('Shop FE');
  const api = html.indexOf('Api BE');
  const promo = html.indexOf('promo field');
  const early = html.indexOf('early shop');

  assert.ok(newer !== -1 && older !== -1, 'each day is a top-level heading');
  assert.ok(
    newer < shop && shop < api && api < older && older < early,
    'newer days come first, and projects sit inside their day',
  );
  assert.ok(shop < promo && promo < api, 'a project’s commits stay with that project');
  assert.ok(!html.includes('<h2>Shop FE</h2>'), 'projects are no longer the outer heading');
});

test('a report without estimates carries no estimate markup', () => {
  const html = renderReport({
    projects: sampleProjects(),
    totals: summarizeTotals(sampleProjects()),
    meta: {
      from: '2026-08-03',
      to: '2026-08-03',
      author: 'dev@example.com',
      model: null,
      generatedAt: new Date('2026-08-03T12:00:00Z'),
    },
  });

  assert.ok(!html.includes('<span class="est">'), 'no day should carry a badge');
  assert.ok(!html.includes('Estimated hours'), 'the header card should be left out');
});
