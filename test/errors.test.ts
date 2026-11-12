import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EngineVersionNotSupportedError,
  InfratexError,
  InvalidEngineVersionError,
  InvalidPipelineError,
  InvalidSpeedError,
  PipelineNotAvailableError,
  SpeedNotSupportedError,
} from '../src/index.js';
import { createClient, json, mockFetch } from './helpers.js';

async function caught(promise: Promise<unknown>): Promise<InfratexError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof InfratexError, `expected an InfratexError, got ${String(error)}`);
    return error;
  }
  throw new Error('expected the call to throw');
}

test('reads the API error envelope', async (t) => {
  mockFetch(t, () =>
    new Response(
      JSON.stringify({
        error: {
          code: 'idempotency_request_in_progress',
          message: 'A request with this Idempotency-Key is still running',
          request_id: 'req-123',
          details: { key: 'k-1' },
        },
      }),
      { status: 409, headers: { 'content-type': 'application/json', 'retry-after': '2' } },
    ),
  );

  const error = await caught(createClient().documents.get('doc-1'));

  assert.equal(error.constructor, InfratexError);
  assert.equal(error.status, 409);
  assert.equal(error.code, 'idempotency_request_in_progress');
  assert.equal(error.message, 'A request with this Idempotency-Key is still running');
  assert.deepEqual(error.details, { key: 'k-1' });
  assert.equal(error.requestId, 'req-123');
  assert.equal(error.retryAfter, 2);
});

test('reads the top-level and detail shapes', async (t) => {
  mockFetch(t, () => json({ code: 'not_found', message: 'Document not found', details: null }, 404));
  const topLevel = await caught(createClient().documents.get('doc-1'));
  assert.equal(topLevel.code, 'not_found');
  assert.equal(topLevel.message, 'Document not found');
  assert.equal(topLevel.details, undefined);
});

test('reads a FastAPI detail object', async (t) => {
  mockFetch(t, () => json({ detail: { code: 'dashboard_only', message: 'Use the dashboard', details: null } }, 403));
  const nested = await caught(createClient().account.settings());
  assert.equal(nested.code, 'dashboard_only');
  assert.equal(nested.message, 'Use the dashboard');
});

test('falls back to the request id header and a text body', async (t) => {
  mockFetch(t, () => new Response('Bad gateway', { status: 502, headers: { 'x-request-id': 'req-9' } }));

  const error = await caught(createClient().documents.get('doc-1'));

  assert.equal(error.message, 'Bad gateway');
  assert.equal(error.code, undefined);
  assert.equal(error.requestId, 'req-9');
  assert.equal(error.retryAfter, undefined);
});

test('keeps validation errors under details.errors', async (t) => {
  const errors = [{ loc: ['body', 'query'], msg: 'Field required', type: 'missing' }];
  mockFetch(t, () =>
    json({ error: { code: 'validation_error', message: 'Request validation failed', details: errors } }, 422),
  );

  const error = await caught(createClient().searches.create({ query: 'x' }));

  assert.equal(error.code, 'validation_error');
  assert.deepEqual(error.details, { errors });
});

test('invalid_pipeline is an InvalidPipelineError', async (t) => {
  mockFetch(t, () =>
    json(
      {
        error: {
          code: 'invalid_pipeline',
          message: "'pipeline' must be one of 'legacy', 'v2'.",
          request_id: 'req-1',
          details: { allowed_pipelines: ['legacy', 'v2'] },
        },
      },
      422,
    ),
  );

  const error = await caught(
    createClient().extractions.create({
      document_id: 'doc-1',
      template_id: 'tpl-1',
      pipeline: 'v3' as 'v2',
    }),
  );

  assert.ok(error instanceof InvalidPipelineError);
  assert.equal(error.name, 'InvalidPipelineError');
  assert.equal(error.status, 422);
  assert.deepEqual(error.allowedPipelines, ['legacy', 'v2']);
});

test('pipeline_not_available is a PipelineNotAvailableError', async (t) => {
  mockFetch(t, () =>
    json(
      {
        error: {
          code: 'pipeline_not_available',
          message: 'The v2 extraction pipeline (beta) is not enabled for this account.',
          request_id: 'req-2',
          details: { requested_pipeline: 'v2', available_pipelines: ['legacy'] },
        },
      },
      422,
    ),
  );

  const error = await caught(
    createClient().extractions.create({ document_id: 'doc-1', template_id: 'tpl-1', pipeline: 'v2' }),
  );

  assert.ok(error instanceof PipelineNotAvailableError);
  assert.ok(!(error instanceof InvalidPipelineError));
  assert.equal(error.requestedPipeline, 'v2');
  assert.deepEqual(error.availablePipelines, ['legacy']);
  assert.equal(error.requestId, 'req-2');
});

const ENGINE_REFUSALS = [
  { code: 'invalid_engine_version', errorClass: InvalidEngineVersionError, allowed: ['2.0', '2.5'] },
  { code: 'engine_version_not_supported', errorClass: EngineVersionNotSupportedError, allowed: ['standard-ultra-2'] },
  { code: 'invalid_speed', errorClass: InvalidSpeedError, allowed: ['standard', 'fast'] },
  { code: 'speed_not_supported', errorClass: SpeedNotSupportedError, allowed: ['standard-ultra-2'] },
] as const;

for (const { code, errorClass, allowed } of ENGINE_REFUSALS) {
  test(`${code} is typed as ${errorClass.name}`, async (t) => {
    mockFetch(t, () =>
      json({ error: { code, message: 'Refused.', request_id: 'req-4', details: { allowed } } }, 422),
    );

    const error = await caught(
      createClient().documents.upload(Buffer.from('%PDF'), {
        filename: 'a.pdf',
        method: 'standard-ultra-2',
        engine_version: '2.5',
        wait: false,
      }),
    );

    assert.ok(error instanceof errorClass);
    assert.equal(error.name, errorClass.name);
    assert.equal(error.status, 422);
    assert.equal(error.code, code);
    assert.equal(error.requestId, 'req-4');
    assert.deepEqual(error.allowed, allowed);
  });
}

test('allowed is empty when the API sends no details', async (t) => {
  mockFetch(t, () => json({ error: { code: 'speed_not_supported', message: 'Refused.', details: null } }, 422));

  const error = await caught(
    createClient().documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', method: 'max', speed: 'fast', wait: false }),
  );

  assert.ok(error instanceof SpeedNotSupportedError);
  assert.deepEqual(error.allowed, []);
});

test('streamed responses throw the same errors', async (t) => {
  mockFetch(t, () =>
    json({ error: { code: 'data_policy_violation', message: 'Not in the EU', details: null } }, 422),
  );

  const error = await caught(createClient().responses.create({ message: 'hi' }));

  assert.equal(error.code, 'data_policy_violation');
  assert.equal(error.message, 'Not in the EU');
});
