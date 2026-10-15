import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, formOf, json, last, mockFetch } from './helpers.js';

const QUEUED = { id: 'doc-1', filename: 'report.pdf', status: 'pending', method: 'standard' };
const queued = () => json(QUEUED, 202);

test('upload sends the infratex-gamma method', async (t) => {
  const requests = mockFetch(t, queued);

  await createClient().documents.upload(Buffer.from('%PDF-1.7 test'), {
    filename: 'report.pdf',
    method: 'infratex-gamma',
    wait: false,
  });

  const request = last(requests);
  assert.equal(request.url.pathname, '/api/v1/documents');
  assert.equal(formOf(request).get('method'), 'infratex-gamma');
});
