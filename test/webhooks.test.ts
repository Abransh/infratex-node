import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyWebhookSignature } from '../src/index.js';
import { createClient, json, jsonOf, last, mockFetch } from './helpers.js';

const WEBHOOK = {
  id: 'wh-1',
  url: 'https://example.com/infratex',
  description: 'prod',
  events: ['document.parsed'],
  enabled: true,
  created_at: '2026-11-10T10:00:00Z',
  updated_at: '2026-11-10T10:00:00Z',
};

const DELIVERY = {
  id: 'del-1',
  event_id: 'evt_abc',
  event_type: 'webhook.test',
  status: 'pending',
  attempts: 0,
  last_status_code: null,
  last_error: null,
  created_at: '2026-11-10T10:00:00Z',
  last_attempt_at: null,
  delivered_at: null,
  next_attempt_at: '2026-11-10T10:00:00Z',
};

test('create returns the secret', async (t) => {
  const requests = mockFetch(t, () => json({ ...WEBHOOK, secret: 'whsec_abc' }, 201));

  const webhook = await createClient().webhooks.create({
    url: 'https://example.com/infratex',
    events: ['document.parsed'],
    description: 'prod',
  });

  const request = last(requests);
  assert.equal(request.method, 'POST');
  assert.equal(request.url.pathname, '/api/v1/webhooks');
  assert.deepEqual(jsonOf(request), {
    url: 'https://example.com/infratex',
    events: ['document.parsed'],
    description: 'prod',
  });
  assert.equal(webhook.secret, 'whsec_abc');
});

test('create sends only the url by default', async (t) => {
  const requests = mockFetch(t, () => json({ ...WEBHOOK, secret: 's' }, 201));

  await createClient().webhooks.create({ url: 'https://example.com/infratex' });

  assert.deepEqual(jsonOf(last(requests)), { url: 'https://example.com/infratex' });
});

test('list and get', async (t) => {
  const requests = mockFetch(t, (request) =>
    request.url.pathname === '/api/v1/webhooks' ? json([WEBHOOK]) : json(WEBHOOK),
  );
  const client = createClient();

  const listed = await client.webhooks.list();
  const fetched = await client.webhooks.get('wh-1');

  assert.deepEqual(
    requests.map((request) => request.url.pathname),
    ['/api/v1/webhooks', '/api/v1/webhooks/wh-1'],
  );
  assert.equal(listed.length, 1);
  assert.equal(fetched.id, 'wh-1');
});

test('update sends only the given fields, null clears the description', async (t) => {
  const requests = mockFetch(t, () => json(WEBHOOK));
  const client = createClient();

  await client.webhooks.update('wh-1', { enabled: false });
  await client.webhooks.update('wh-1', { events: [], description: null });

  assert.equal(requests[0]?.method, 'PATCH');
  assert.equal(requests[0]?.url.pathname, '/api/v1/webhooks/wh-1');
  assert.deepEqual(jsonOf(requests[0]!), { enabled: false });
  assert.deepEqual(jsonOf(requests[1]!), { events: [], description: null });
});

test('update rejects an empty change before sending', async (t) => {
  const requests = mockFetch(t, () => json(WEBHOOK));

  await assert.rejects(createClient().webhooks.update('wh-1', {}), /update requires/);
  assert.equal(requests.length, 0);
});

test('delete, rotateSecret, test and retryDelivery', async (t) => {
  const requests = mockFetch(t, (request) => {
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    if (request.url.pathname.endsWith('/rotate-secret')) return json({ secret: 'whsec_new' });
    return json(DELIVERY, 202);
  });
  const client = createClient();

  await client.webhooks.delete('wh-1');
  const secret = await client.webhooks.rotateSecret('wh-1');
  const testEvent = await client.webhooks.test('wh-1');
  const retried = await client.webhooks.retryDelivery('wh-1', 'del-1');

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url.pathname}`),
    [
      'DELETE /api/v1/webhooks/wh-1',
      'POST /api/v1/webhooks/wh-1/rotate-secret',
      'POST /api/v1/webhooks/wh-1/test',
      'POST /api/v1/webhooks/wh-1/deliveries/del-1/retry',
    ],
  );
  assert.equal(secret.secret, 'whsec_new');
  assert.equal(testEvent.event_type, 'webhook.test');
  assert.equal(retried.id, 'del-1');
});

test('listDeliveries forwards filters and checks limit', async (t) => {
  const requests = mockFetch(t, () => json({ items: [DELIVERY] }));
  const client = createClient();

  const deliveries = await client.webhooks.listDeliveries('wh-1', { status: 'failed', limit: 10 });
  await client.webhooks.listDeliveries('wh-1');
  await assert.rejects(client.webhooks.listDeliveries('wh-1', { limit: 101 }), RangeError);

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url.pathname, '/api/v1/webhooks/wh-1/deliveries');
  assert.equal(requests[0]?.url.search, '?status=failed&limit=10');
  assert.equal(requests[1]?.url.search, '');
  assert.equal(deliveries.items[0]?.status, 'pending');
});

const SECRET = 'whsec_test';
const PAYLOAD = '{"id":"evt_1","type":"document.parsed"}';

function signature(timestamp: number, body = PAYLOAD, secret = SECRET): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('verifyWebhookSignature accepts a valid recent signature', () => {
  const header = signature(1_800_000_000);

  assert.equal(verifyWebhookSignature(SECRET, PAYLOAD, header, { now: 1_800_000_100 }), true);
  assert.equal(verifyWebhookSignature(SECRET, Buffer.from(PAYLOAD), header, { now: 1_800_000_000 }), true);
  assert.equal(
    verifyWebhookSignature(SECRET, PAYLOAD, `v1=${'0'.repeat(64)},${header}`, { now: 1_800_000_000 }),
    true,
  );
});

test('verifyWebhookSignature rejects tampered, foreign, stale and malformed signatures', () => {
  const header = signature(1_800_000_000);
  const now = 1_800_000_000;

  assert.equal(verifyWebhookSignature(SECRET, '{"id":"evt_2"}', header, { now }), false);
  assert.equal(verifyWebhookSignature('whsec_other', PAYLOAD, header, { now }), false);
  assert.equal(verifyWebhookSignature(SECRET, PAYLOAD, header, { now: now + 301 }), false);
  assert.equal(verifyWebhookSignature(SECRET, PAYLOAD, 'v1=abc', { now }), false);
  assert.equal(verifyWebhookSignature(SECRET, PAYLOAD, 't=soon,v1=abc', { now }), false);
  assert.equal(verifyWebhookSignature(SECRET, PAYLOAD, 't=1800000000,v1=é', { now }), false);
});
