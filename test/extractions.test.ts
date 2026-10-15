import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FieldDefinition } from '../src/index.js';
import { createClient, json, jsonOf, last, mockFetch, type RecordedRequest } from './helpers.js';

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
