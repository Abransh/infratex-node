import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Read a path or copy a Buffer into bytes a Blob accepts, with a filename. */
export async function loadUploadInput(
  file: string | Buffer,
  explicitFilename: string | undefined,
  fallbackFilename: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  const data = typeof file === 'string' ? await readFile(file) : file;
  const filename =
    explicitFilename ?? (typeof file === 'string' ? basename(file) : fallbackFilename);
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return { bytes, filename };
}

/** The fallback name of an unnamed Buffer: a ZIP package is a .docx, anything else a PDF. */
export function fallbackDocumentFilename(file: string | Buffer): string {
  return typeof file !== 'string' && isZipArchive(file) ? 'upload.docx' : 'upload.pdf';
}

export function documentContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return DOCX_CONTENT_TYPE;
  // The API identifies the document from its bytes; a neutral type is accepted.
  return 'application/octet-stream';
}

export function imageContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

/** A PDF, a .docx or one image: the content type of any file `POST /api/v1/extractions` takes. */
export function uploadContentType(filename: string): string {
  const image = imageContentType(filename);
  return image === 'application/octet-stream' ? documentContentType(filename) : image;
}

/** A .docx is a ZIP package; a PDF starts with `%PDF`. */
function isZipArchive(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
