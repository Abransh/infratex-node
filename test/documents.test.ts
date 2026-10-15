import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BinaryResponse, InfratexError } from '../src/index.js';
import { createClient, formOf, json, last, mockFetch } from './helpers.js';

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
