import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BinaryResponse,
  EncryptedPdfError,
  Infratex,
  InfratexError,
  type DocumentProgress,
} from '../src/index.js';
import { createClient, formOf, json, jsonOf, last, mockFetch } from './helpers.js';

const QUEUED = { id: 'doc-1', filename: 'report.pdf', status: 'pending', method: 'standard' };
const queued = () => json(QUEUED, 202);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function tempFile(name: string, content: Uint8Array | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'infratex-test-'));
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

function filePart(form: FormData, name = 'file'): File {
  const part = form.get(name);
  if (part === null || typeof part === 'string') throw new Error(`form field ${name} is not a file`);
  return part;
}

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

test('upload sends a .docx path with its Word content type', async (t) => {
  const requests = mockFetch(t, queued);
  const path = await tempFile('contract.docx', Buffer.from('PK\x03\x04 word package', 'latin1'));

  await createClient().documents.upload(path, { wait: false });

  const file = filePart(formOf(last(requests)));
  assert.equal(file.name, 'contract.docx');
  assert.equal(file.type, DOCX);
  assert.equal(Buffer.from(await file.arrayBuffer()).toString('latin1'), 'PK\x03\x04 word package');
});

test('upload keeps application/pdf for PDFs', async (t) => {
  const requests = mockFetch(t, queued);

  await createClient().documents.upload(Buffer.from('%PDF-1.7'), { filename: 'Report.PDF', wait: false });

  assert.equal(filePart(formOf(last(requests))).type, 'application/pdf');
});

test('upload names an unnamed .docx Buffer upload.docx', async (t) => {
  const requests = mockFetch(t, queued);

  await createClient().documents.upload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]), { wait: false });

  const file = filePart(formOf(last(requests)));
  assert.equal(file.name, 'upload.docx');
  assert.equal(file.type, DOCX);
});

test('upload does not reject other extensions', async (t) => {
  const requests = mockFetch(t, queued);
  const path = await tempFile('scan', '%PDF-1.7');

  await createClient().documents.upload(path, { wait: false });

  const file = filePart(formOf(last(requests)));
  assert.equal(file.name, 'scan');
  assert.equal(file.type, 'application/octet-stream');
});

test('upload sends table_format only when given', async (t) => {
  const requests = mockFetch(t, queued);
  const client = createClient();

  await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', method: 'max', table_format: 'html', wait: false });
  await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', wait: false });

  const [withFormat, withoutFormat] = requests.map(formOf);
  assert.equal(withFormat?.get('table_format'), 'html');
  assert.equal(withoutFormat?.has('table_format'), false);
});

test('uploadImages sends table_format', async (t) => {
  const requests = mockFetch(t, queued);
  const page = await tempFile('page-1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  await createClient().documents.uploadImages([page], { table_format: 'otsl', wait: false });

  const request = last(requests);
  assert.equal(request.url.pathname, '/api/v1/documents/images');
  assert.equal(formOf(request).get('table_format'), 'otsl');
});

const markdownResponse = () =>
  new Response('<!-- page:1 -->\n# Title', { headers: { 'content-type': 'text/markdown' } });

test('markdown sends no query by default', async (t) => {
  const requests = mockFetch(t, markdownResponse);

  const text = await createClient().documents.markdown('doc-1');

  assert.equal(text, '<!-- page:1 -->\n# Title');
  assert.equal(last(requests).url.href, 'https://api.test/api/v1/documents/doc-1/markdown');
});

test('markdown forwards table_format', async (t) => {
  const requests = mockFetch(t, markdownResponse);

  await createClient().documents.markdown('doc-1', { table_format: 'html' });

  assert.equal(last(requests).url.search, '?table_format=html');
});

test('markdown sends figure_descriptions only when set', async (t) => {
  const requests = mockFetch(t, markdownResponse);
  const client = createClient();

  await client.documents.markdown('doc-1', { figure_descriptions: false });
  await client.documents.markdown('doc-1', { table_format: 'html', figure_descriptions: true });
  await client.documents.markdown('doc-1', { table_format: 'html' });

  assert.deepEqual(
    requests.map((request) => request.url.search),
    ['?figure_descriptions=false', '?table_format=html&figure_descriptions=true', '?table_format=html'],
  );
});

const FIGURES = {
  document_id: 'doc-1',
  figures: [
    {
      name: 'p2-1.png',
      src: 'figures/p2-1.png',
      page: 2,
      index: 1,
      type: 'chart',
      score: 0.93,
      bbox: [72.0, 100.5, 300.0, 280.25],
    },
  ],
};

test('listFigures returns the figure manifest', async (t) => {
  const requests = mockFetch(t, () => json(FIGURES));

  const result = await createClient().documents.listFigures('doc-1');

  assert.equal(last(requests).url.pathname, '/api/v1/documents/doc-1/figures');
  assert.deepEqual(result, FIGURES);
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });

test('downloadFigure returns PNG bytes named after the figure', async (t) => {
  const requests = mockFetch(t, png);

  const figure = await createClient().documents.downloadFigure('doc-1', 'p2-1.png');

  assert.equal(last(requests).url.pathname, '/api/v1/documents/doc-1/figures/p2-1.png');
  assert.ok(figure instanceof BinaryResponse);
  assert.deepEqual(figure.content, PNG);
  assert.equal(figure.contentType, 'image/png');
  assert.equal(figure.filename, 'p2-1.png');
});

test('downloadFigure accepts the markdown src', async (t) => {
  const requests = mockFetch(t, png);

  await createClient().documents.downloadFigure('doc-1', 'figures/p2-1.png');

  assert.equal(last(requests).url.pathname, '/api/v1/documents/doc-1/figures/p2-1.png');
});

test('downloadFigure throws InfratexError for a missing figure', async (t) => {
  mockFetch(t, () => json({ code: 'not_found', message: 'Figure not found', details: null }, 404));

  await assert.rejects(
    createClient().documents.downloadFigure('doc-1', 'p9-9.png'),
    (error: unknown) =>
      error instanceof InfratexError &&
      error.status === 404 &&
      error.code === 'not_found' &&
      error.message === 'Figure not found',
  );
});

test('upload sends gamma options as JSON only when given', async (t) => {
  const requests = mockFetch(t, queued);
  const client = createClient();

  await client.documents.upload(Buffer.from('%PDF'), {
    filename: 'a.pdf',
    method: 'infratex-gamma',
    options: { merge_tables: false, ignore_labels: ['header', 'footer'] },
    wait: false,
  });
  await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', wait: false });

  const [withOptions, withoutOptions] = requests.map(formOf);
  assert.deepEqual(JSON.parse(String(withOptions?.get('options'))), {
    merge_tables: false,
    ignore_labels: ['header', 'footer'],
  });
  assert.equal(withoutOptions?.has('options'), false);
});

test('uploadImages sends options', async (t) => {
  const requests = mockFetch(t, queued);
  const page = await tempFile('page-1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  await createClient().documents.uploadImages([page], {
    method: 'infratex-gamma',
    options: { unwarp: true },
    wait: false,
  });

  assert.deepEqual(JSON.parse(String(formOf(last(requests)).get('options'))), { unwarp: true });
});

test('create calls send the Idempotency-Key header', async (t) => {
  const index = {
    id: 'idx-1',
    document_id: 'doc-1',
    method: 'hybrid',
    status: 'pending',
    node_count: null,
    chunk_count: null,
    has_ast: false,
    has_description: false,
    processing_time_ms: null,
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
  };
  const requests = mockFetch(t, (request) =>
    request.url.pathname.endsWith('/indexes') ? json(index, 202) : queued(),
  );
  const client = createClient();
  const page = await tempFile('page-1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', idempotency_key: 'upload-key', wait: false });
  await client.documents.uploadImages([page], { idempotency_key: 'images-key', wait: false });
  await client.documents.index('doc-1', { method: 'hybrid', idempotency_key: 'index-key', wait: false });
  await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', wait: false });

  assert.deepEqual(
    requests.map((request) => request.headers.get('idempotency-key')),
    ['upload-key', 'images-key', 'index-key', null],
  );
  assert.deepEqual(jsonOf(requests[2]!), { method: 'hybrid' });
});

const LAYOUT = {
  document_id: 'doc-1',
  pages: [
    {
      page: 1,
      width: 1240,
      height: 1754,
      regions: [{ id: 0, label: 'title', bbox: [100, 80, 900, 140], content: 'Annual report', page: 1 }],
    },
  ],
};

test('layout returns the pages and regions', async (t) => {
  const requests = mockFetch(t, () => json(LAYOUT));

  const layout = await createClient().documents.layout('doc-1');

  assert.equal(last(requests).url.pathname, '/api/v1/documents/doc-1/layout');
  assert.deepEqual(layout, LAYOUT);
});

test('layout throws layout_not_available for other methods', async (t) => {
  mockFetch(t, () =>
    json({ error: { code: 'layout_not_available', message: 'This document has no layout.', request_id: 'r' } }, 404),
  );

  await assert.rejects(
    createClient().documents.layout('doc-1'),
    (error: unknown) => error instanceof InfratexError && error.code === 'layout_not_available',
  );
});

function progress(stage: DocumentProgress['stage'], done: number, attempt = 1, updated = '2026-11-10T09:41:07Z'): DocumentProgress {
  return { stage, pages_done: done, pages_total: 3, attempt, max_attempts: 3, updated_at: updated };
}

function documentState(status: string, documentProgress: DocumentProgress | null, error: string | null = null) {
  return {
    id: 'doc-1',
    filename: 'report.pdf',
    upload_time: '2026-11-10T09:40:00Z',
    status,
    method: 'standard',
    pipeline: null,
    page_count: 3,
    processing_time_ms: 900,
    error_message: error,
    markdown_size_bytes: null,
    chunk_count: null,
    index_method: null,
    collection_id: null,
    extraction_pages: null,
    indexes: [],
    progress: documentProgress,
  };
}

function sequence(...states: ReturnType<typeof documentState>[]) {
  const queue = [...states];
  return (request: { url: URL }) => {
    if (request.url.pathname.endsWith('/markdown')) return markdownResponse();
    const next = queue.shift();
    if (next === undefined) throw new Error('no more document states');
    return json(next);
  };
}

function withoutPollDelay(client: Infratex): Infratex {
  (client.documents as unknown as { pollIntervalMs: number }).pollIntervalMs = 0;
  return client;
}

test('get returns progress while processing', async (t) => {
  mockFetch(t, () => json(documentState('processing', progress('parsing', 2))));

  const document = await createClient().documents.get('doc-1');

  assert.deepEqual(document.progress, progress('parsing', 2));
});

test('waitUntilParsed reports each new progress', async (t) => {
  mockFetch(
    t,
    sequence(
      documentState('pending', progress('queued', 0, 0)),
      documentState('processing', null),
      documentState('processing', progress('parsing', 1)),
      documentState('processing', progress('parsing', 1)),
      documentState('processing', progress('parsing', 1, 1, '2026-11-10T09:41:37Z')),
      documentState('processing', progress('finishing', 3)),
      documentState('parsed', null),
    ),
  );
  const seen: DocumentProgress[] = [];

  const uploaded = await withoutPollDelay(createClient()).documents.waitUntilParsed('doc-1', {
    onProgress: (p) => seen.push(p),
  });

  assert.deepEqual(seen, [
    progress('queued', 0, 0),
    progress('parsing', 1),
    progress('parsing', 1, 1, '2026-11-10T09:41:37Z'),
    progress('finishing', 3),
  ]);
  assert.equal(uploaded.status, 'parsed');
  assert.equal(uploaded.markdown, '<!-- page:1 -->\n# Title');
});

test('waitUntilParsed works without a callback', async (t) => {
  mockFetch(t, sequence(documentState('processing', progress('parsing', 1)), documentState('parsed', null)));

  const uploaded = await withoutPollDelay(createClient()).documents.waitUntilParsed('doc-1');

  assert.equal(uploaded.status, 'parsed');
});

test('waitUntilParsed throws the document error_message', async (t) => {
  const message = 'The PDF is password-protected, so its pages could not be read. No credits were charged.';
  mockFetch(
    t,
    sequence(documentState('processing', progress('parsing', 0)), documentState('error', null, message)),
  );

  await assert.rejects(
    withoutPollDelay(createClient()).documents.waitUntilParsed('doc-1'),
    (error: unknown) =>
      error instanceof InfratexError &&
      error.message === message &&
      error.code === 'document_processing_failed' &&
      (error.details as { document_id?: string } | undefined)?.document_id === 'doc-1',
  );
});

test('waitUntilParsed timeout carries the last progress', async (t) => {
  mockFetch(t, () => json(documentState('processing', progress('parsing', 2))));
  const client = withoutPollDelay(new Infratex({ apiKey: 'infratex_sk_test', baseUrl: 'https://api.test', timeout: 0 }));

  await assert.rejects(client.documents.waitUntilParsed('doc-1'), (error: unknown) => {
    assert.ok(error instanceof InfratexError);
    assert.equal(error.code, 'upload_timeout');
    assert.deepEqual(error.details, { document_id: 'doc-1', progress: progress('parsing', 2) });
    return true;
  });
});

test('upload of a password-protected PDF throws EncryptedPdfError', async (t) => {
  mockFetch(t, () =>
    json(
      {
        error: {
          code: 'encrypted_pdf',
          message: 'The PDF is password-protected. Remove the password and upload it again.',
          request_id: 'req-3',
        },
      },
      400,
    ),
  );

  await assert.rejects(
    createClient().documents.upload(Buffer.from('%PDF-1.7'), { filename: 'locked.pdf', wait: false }),
    (error: unknown) =>
      error instanceof EncryptedPdfError &&
      error instanceof InfratexError &&
      error.name === 'EncryptedPdfError' &&
      error.status === 400 &&
      error.code === 'encrypted_pdf' &&
      error.requestId === 'req-3',
  );
});

test('upload sends engine_version only when given', async (t) => {
  const requests = mockFetch(t, queued);
  const client = createClient();

  await client.documents.upload(Buffer.from('%PDF'), {
    filename: 'a.pdf',
    method: 'standard-ultra-2',
    engine_version: '2.5',
    wait: false,
  });
  await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf', method: 'standard-ultra-2', wait: false });

  const [withVersion, withoutVersion] = requests.map(formOf);
  assert.equal(requests[0]?.url.pathname, '/api/v1/documents');
  assert.equal(withVersion?.get('method'), 'standard-ultra-2');
  assert.equal(withVersion?.get('engine_version'), '2.5');
  assert.equal(withoutVersion?.has('engine_version'), false);
});

test('uploadImages sends engine_version only when given', async (t) => {
  const requests = mockFetch(t, queued);
  const page = await tempFile('page-1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const client = createClient();

  await client.documents.uploadImages([page], { method: 'standard-ultra-2', engine_version: '2.0', wait: false });
  await client.documents.uploadImages([page], { wait: false });

  const [withVersion, withoutVersion] = requests.map(formOf);
  assert.equal(requests[0]?.url.pathname, '/api/v1/documents/images');
  assert.equal(withVersion?.get('engine_version'), '2.0');
  assert.equal(withoutVersion?.has('engine_version'), false);
});

test('upload passes an unknown engine_version through to the API', async (t) => {
  const requests = mockFetch(t, queued);

  await createClient().documents.upload(Buffer.from('%PDF'), {
    filename: 'a.pdf',
    method: 'standard-ultra-2',
    engine_version: '3.0' as '2.5',
    wait: false,
  });

  assert.equal(formOf(last(requests)).get('engine_version'), '3.0');
});

test('documents report engine_version', async (t) => {
  mockFetch(t, () => json({ ...documentState('parsed', null), method: 'standard-ultra-2', engine_version: '2.5' }));

  const document = await createClient().documents.get('doc-1');

  assert.equal(document.engine_version, '2.5');
});

test('a waited upload reports engine_version, null when absent', async (t) => {
  const parsed = { ...documentState('parsed', null), method: 'standard-ultra-2', engine_version: '2.0' };
  let state: Record<string, unknown> = parsed;
  mockFetch(t, (request) => {
    if (request.method === 'POST') return queued();
    if (request.url.pathname.endsWith('/markdown')) return markdownResponse();
    return json(state);
  });
  const client = withoutPollDelay(createClient());

  const uploaded = await client.documents.upload(Buffer.from('%PDF'), {
    filename: 'a.pdf',
    method: 'standard-ultra-2',
    engine_version: '2.0',
  });
  assert.equal(uploaded.engine_version, '2.0');

  state = documentState('parsed', null);
  const plain = await client.documents.upload(Buffer.from('%PDF'), { filename: 'a.pdf' });
  assert.equal(plain.engine_version, null);
});

const PARSE_ENGINES = [
  { method: 'standard', versions: [] },
  {
    method: 'standard-ultra-2',
    versions: [
      { version: '2.0', status: 'stable', default: true },
      { version: '2.5', status: 'beta', default: false },
    ],
  },
];

test('parseEngines returns each method with its engine versions', async (t) => {
  const requests = mockFetch(t, () => json(PARSE_ENGINES));

  const engines = await createClient().documents.parseEngines();

  const request = last(requests);
  assert.equal(request.method, 'GET');
  assert.equal(request.url.pathname, '/api/v1/parse-engines');
  assert.deepEqual(engines, PARSE_ENGINES);
  const ultra = engines.find((engine) => engine.method === 'standard-ultra-2');
  assert.equal(ultra?.versions.find((version) => version.default)?.version, '2.0');
});
