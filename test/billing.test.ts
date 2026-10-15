import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingTransaction } from '../src/index.js';
import { createClient, json, last, mockFetch } from './helpers.js';

function transaction(id: string, createdAt: string): BillingTransaction {
  return {
    id,
    transaction_type: 'usage_charge',
    status: 'posted',
    amount_micros: -15000,
    balance_after_micros: 985000,
    currency: 'EUR',
    source_type: 'document',
    source_id: 'doc-1',
    description: 'Parsing Standard: report.pdf (3 pages)',
    created_at: createdAt,
    metadata: { pages: 3 },
  };
}

function page(ids: string[], nextBefore: string | null = null): Response {
  return json({
    transactions: ids.map((id, i) => transaction(id, `2026-10-1${i}T10:00:00Z`)),
    next_before: nextBefore,
  });
}

const params = (url: URL) => Object.fromEntries(url.searchParams);

test('listTransactions sends filters and returns the page', async (t) => {
  const requests = mockFetch(t, () => page(['tx-1'], '2026-10-10T10:00:00Z'));

  const result = await createClient().billing.listTransactions({
    since: new Date(Date.UTC(2026, 9, 1)),
    until: '2026-10-15T00:00:00Z',
    before: '2026-10-12T08:30:00+02:00',
    limit: 500,
  });

  const request = last(requests);
  assert.equal(request.url.pathname, '/api/v1/billing/transactions');
  assert.deepEqual(params(request.url), {
    since: '2026-10-01T00:00:00.000Z',
    until: '2026-10-15T00:00:00Z',
    before: '2026-10-12T08:30:00+02:00',
    limit: '500',
  });
  // "+" in an offset must be percent-encoded, or the server reads a space.
  assert.ok(request.url.search.includes('before=2026-10-12T08%3A30%3A00%2B02%3A00'));
  assert.equal(result.next_before, '2026-10-10T10:00:00Z');
  assert.equal(result.transactions[0]?.source_id, 'doc-1');
});

test('listTransactions sends no query by default', async (t) => {
  const requests = mockFetch(t, () => page([]));

  const result = await createClient().billing.listTransactions();

  assert.equal(last(requests).url.search, '');
  assert.deepEqual(result, { transactions: [], next_before: null });
});

test('listTransactions rejects an out-of-range limit before any request', async (t) => {
  const requests = mockFetch(t, () => page([]));
  const client = createClient();

  for (const limit of [0, 501, 1.5]) {
    await assert.rejects(client.billing.listTransactions({ limit }), RangeError);
  }
  assert.equal(requests.length, 0);
});

test('iterTransactions follows next_before until the last page', async (t) => {
  const pages: Record<string, () => Response> = {
    '': () => page(['tx-3', 'tx-2'], '2026-10-11T10:00:00Z'),
    '2026-10-11T10:00:00Z': () => page(['tx-1']),
  };
  const requests = mockFetch(t, (request) => {
    const respond = pages[request.url.searchParams.get('before') ?? ''];
    if (!respond) throw new Error(`unexpected request ${request.url.href}`);
    return respond();
  });

  const ids: string[] = [];
  for await (const tx of createClient().billing.iterTransactions({ since: '2026-10-01T00:00:00Z', page_size: 2 })) {
    ids.push(tx.id);
  }

  assert.deepEqual(ids, ['tx-3', 'tx-2', 'tx-1']);
  assert.deepEqual(
    requests.map((request) => params(request.url)),
    [
      { since: '2026-10-01T00:00:00Z', limit: '2' },
      { since: '2026-10-01T00:00:00Z', before: '2026-10-11T10:00:00Z', limit: '2' },
    ],
  );
});

test('iterTransactions fetches lazily, 500 per page by default', async (t) => {
  const requests = mockFetch(t, () => page(['tx-2', 'tx-1'], '2026-10-10T10:00:00Z'));

  const iterator = createClient().billing.iterTransactions();
  assert.equal(requests.length, 0);

  const first = await iterator.next();
  assert.equal(first.value?.id, 'tx-2');
  assert.equal(requests.length, 1);
  assert.equal(last(requests).url.searchParams.get('limit'), '500');
});

test('iterTransactions validates page_size eagerly', () => {
  assert.throws(() => createClient().billing.iterTransactions({ page_size: 1000 }), RangeError);
});
