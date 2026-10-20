import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, json, last, mockFetch } from './helpers.js';

test('documents.get hits the document route with the API key', async (t) => {
  const requests = mockFetch(t, () =>
    json({ id: 'doc-1', filename: 'a.pdf', status: 'parsed', method: 'standard', indexes: [] }),
  );

  const document = await createClient().documents.get('doc-1');

  assert.equal(document.status, 'parsed');
  const request = last(requests);
  assert.equal(request.method, 'GET');
  assert.equal(request.url.href, 'https://api.test/api/v1/documents/doc-1');
  assert.equal(request.headers.get('authorization'), 'Bearer infratex_sk_test');
});
