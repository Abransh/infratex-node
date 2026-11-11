import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, json, jsonOf, last, mockFetch } from './helpers.js';

const SETTINGS = {
  allow_overage: false,
  monthly_spend_cap_micros: null,
  low_balance_threshold_micros: 2500000,
  has_payment_method: false,
  data_residency: 'eu_only',
};

test('settings report data_residency', async (t) => {
  mockFetch(t, () => json(SETTINGS));

  const settings = await createClient().account.settings();

  assert.equal(settings.data_residency, 'eu_only');
});

test('updateSettings sends only data_residency', async (t) => {
  const requests = mockFetch(t, () => json(SETTINGS));

  const settings = await createClient().account.updateSettings({ data_residency: 'eu_only' });

  const request = last(requests);
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url.pathname, '/api/v1/account/settings');
  assert.deepEqual(jsonOf(request), { data_residency: 'eu_only' });
  assert.equal(settings.data_residency, 'eu_only');
});
