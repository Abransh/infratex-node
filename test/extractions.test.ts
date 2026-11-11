import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FieldDefinition } from '../src/index.js';
import { createClient, formOf, json, jsonOf, last, mockFetch, type RecordedRequest } from './helpers.js';

const FIELDS: FieldDefinition[] = [
  {
    name: 'line_items',
    type: 'array',
    description: 'Every line item',
    items: { name: 'item', type: 'string', description: 'One line item' },
  },
];

function run(request: RecordedRequest): Response {
  const body = jsonOf(request) as { model: string; completeness?: string };
  return json(
    {
      id: 'run-1',
      document_id: 'doc-1',
      template_id: null,
      status: 'pending',
      tier: null,
      model: body.model,
      completeness: body.completeness ?? 'standard',
      result: null,
      evidence: null,
      processing_time_ms: null,
      input_tokens: null,
      output_tokens: null,
      credits_charged: null,
      engine_version: null,
      pipeline: null,
      cached: false,
      error_message: null,
      created_at: '2026-10-15T10:00:00Z',
      updated_at: '2026-10-15T10:00:00Z',
    },
    202,
  );
}

test('create sends exhaustive completeness', async (t) => {
  const requests = mockFetch(t, run);

  const created = await createClient().extractions.create({
    document_id: 'doc-1',
    inline_fields: FIELDS,
    completeness: 'exhaustive',
  });

  const request = last(requests);
  assert.equal(request.url.pathname, '/api/v1/documents/doc-1/extractions');
  assert.deepEqual(jsonOf(request), {
    model: 'fast',
    include_evidence: false,
    inline_fields: FIELDS,
    completeness: 'exhaustive',
  });
  assert.equal(created.completeness, 'exhaustive');
});

test('create omits completeness by default', async (t) => {
  const requests = mockFetch(t, run);

  const created = await createClient().extractions.create({ document_id: 'doc-1', template_id: 'tpl-1' });

  assert.equal('completeness' in (jsonOf(last(requests)) as object), false);
  assert.equal(created.completeness, 'standard');
});

test('create sends pipeline only when set, never as a query parameter', async (t) => {
  const requests = mockFetch(t, run);
  const client = createClient();

  await client.extractions.create({ document_id: 'doc-1', template_id: 'tpl-1', pipeline: 'v2' });
  await client.extractions.create({ document_id: 'doc-1', template_id: 'tpl-1' });

  const [withPipeline, withoutPipeline] = requests;
  assert.equal((jsonOf(withPipeline!) as { pipeline?: string }).pipeline, 'v2');
  assert.equal('pipeline' in (jsonOf(withoutPipeline!) as object), false);
  assert.ok(requests.every((request) => request.url.search === ''));
});

test('create accepts the infratex-phi model', async (t) => {
  const requests = mockFetch(t, run);

  const created = await createClient().extractions.create({
    document_id: 'doc-1',
    template_id: 'tpl-1',
    model: 'infratex-phi',
  });

  assert.equal((jsonOf(last(requests)) as { model: string }).model, 'infratex-phi');
  assert.equal(created.model, 'infratex-phi');
});

test('create sends the Idempotency-Key header and keeps it out of the body', async (t) => {
  const requests = mockFetch(t, run);
  const client = createClient();

  await client.extractions.create({ document_id: 'doc-1', template_id: 'tpl-1', idempotency_key: 'key-1' });
  await client.extractions.create({ document_id: 'doc-1', template_id: 'tpl-1' });

  const [first, second] = requests;
  assert.equal(first?.headers.get('idempotency-key'), 'key-1');
  assert.equal('idempotency_key' in (jsonOf(first!) as object), false);
  assert.equal(second?.headers.has('idempotency-key'), false);
});

const DONE = {
  id: 'run-1',
  document_id: 'doc-1',
  template_id: null,
  status: 'done',
  tier: 'S',
  model: 'fast',
  completeness: 'standard',
  result: { a: 1 },
  evidence: null,
  processing_time_ms: 1200,
  input_tokens: 100,
  output_tokens: 10,
  credits_charged: 25.5,
  engine_version: '2026.11.1',
  pipeline: 'v2',
  cached: false,
  error_message: null,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:01:00Z',
};

test('get forwards wait and reports pipeline, cost and cache', async (t) => {
  const requests = mockFetch(t, () => json(DONE));
  const client = createClient();

  const fetched = await client.extractions.get('run-1', { include_evidence: true, wait: 60 });
  await client.extractions.get('run-1');

  assert.equal(requests[0]?.url.search, '?include_evidence=true&wait=60');
  assert.equal(requests[1]?.url.search, '');
  assert.equal(fetched.pipeline, 'v2');
  assert.equal(fetched.credits_charged, 25.5);
  assert.equal(fetched.cached, false);
});

test('get rejects an out-of-range wait before sending', async (t) => {
  const requests = mockFetch(t, () => json(DONE));

  await assert.rejects(createClient().extractions.get('run-1', { wait: 301 }), RangeError);
  assert.equal(requests.length, 0);
});

test('waitUntilDone does not forward a server-side wait', async (t) => {
  const requests = mockFetch(t, () => json(DONE));

  await createClient().extractions.waitUntilDone('run-1', { include_evidence: true });

  assert.equal(last(requests).url.search, '?include_evidence=true');
});

const PIPELINES = {
  default: 'legacy',
  pipelines: [
    { id: 'legacy', label: 'Standard', stage: 'stable', available: true },
    { id: 'v2', label: 'v2', stage: 'beta', available: false },
  ],
};

test('listPipelines returns the pipelines', async (t) => {
  const requests = mockFetch(t, () => json(PIPELINES));

  const result = await createClient().extractions.listPipelines();

  const request = last(requests);
  assert.equal(request.method, 'GET');
  assert.equal(request.url.pathname, '/api/v1/extraction-pipelines');
  assert.deepEqual(result, PIPELINES);
});

async function tempFile(name: string, content: Uint8Array | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'infratex-test-'));
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

test('createFromFile sends the run as extraction JSON', async (t) => {
  const requests = mockFetch(t, () => json(DONE));
  const path = await tempFile('contract.pdf', '%PDF-1.7 test');

  const created = await createClient().extractions.createFromFile(path, {
    inline_fields: FIELDS,
    model: 'pro',
    completeness: 'exhaustive',
    pipeline: 'v2',
    method: 'max',
    wait: 120,
    idempotency_key: 'key-2',
  });

  const request = last(requests);
  assert.equal(request.method, 'POST');
  assert.equal(request.url.href, 'https://api.test/api/v1/extractions');
  assert.equal(request.headers.get('idempotency-key'), 'key-2');
  const form = formOf(request);
  const file = form.get('file');
  assert.ok(file instanceof File);
  assert.equal(file.name, 'contract.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.equal(form.get('method'), 'max');
  assert.equal(form.get('wait'), '120');
  assert.deepEqual(JSON.parse(String(form.get('extraction'))), {
    model: 'pro',
    include_evidence: false,
    inline_fields: FIELDS,
    completeness: 'exhaustive',
    pipeline: 'v2',
  });
  assert.equal(created.status, 'done');
});

test('createFromFile sends an image Buffer with its type', async (t) => {
  const requests = mockFetch(t, () => json(DONE));

  await createClient().extractions.createFromFile(Buffer.from([0xff, 0xd8, 0xff]), {
    filename: 'invoice.JPG',
    template_id: 'tpl-1',
  });

  const request = last(requests);
  const form = formOf(request);
  const file = form.get('file');
  assert.ok(file instanceof File);
  assert.equal(file.type, 'image/jpeg');
  assert.equal(form.has('method'), false);
  assert.equal(form.has('wait'), false);
  assert.equal(request.headers.has('idempotency-key'), false);
});

test('createFromFile validates before sending', async (t) => {
  const requests = mockFetch(t, () => json(DONE));
  const client = createClient();

  await assert.rejects(client.extractions.createFromFile(Buffer.from('%PDF'), {}), /exactly one/);
  await assert.rejects(
    client.extractions.createFromFile(Buffer.from('%PDF'), { template_id: 'tpl-1', wait: 301 }),
    RangeError,
  );
  assert.equal(requests.length, 0);
});
