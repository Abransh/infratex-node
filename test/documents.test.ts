import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
