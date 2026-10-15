import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { HttpClient, InfratexError } from '../http.js';
import type {
  Document,
  DocumentIndex,
  DocumentListOptions,
  DocumentListResponse,
  DocumentUpdateOptions,
  ImageUploadOptions,
  IndexCreateOptions,
  IndexMethod,
  IndexResponse,
  UploadOptions,
  UploadResponse,
} from '../types.js';

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class Documents {
  private readonly pollIntervalMs = 1000;

  constructor(private readonly http: HttpClient) {}

  /**
   * Upload and parse a PDF or Word (`.docx`) document.
   *
   * Accepts either a file path (string) or a Buffer.
   * When passing a Buffer, provide `options.filename`.
   *
   * A `.docx` is read from the file itself and billed at the `standard` price
   * whatever `method` is sent; the document reports `standard` as its method.
   *
   * @example
   * ```ts
   * const doc = await client.documents.upload('/path/to/report.pdf');
   * const doc = await client.documents.upload(buffer, { filename: 'report.pdf' });
   * const doc = await client.documents.upload('/path/to/contract.docx');
   * ```
   */
  async upload(
    file: string | Buffer,
    options: UploadOptions & { wait: false },
  ): Promise<Document>;
  async upload(
    file: string | Buffer,
    options?: UploadOptions,
  ): Promise<UploadResponse>;
  async upload(
    file: string | Buffer,
    options?: UploadOptions,
  ): Promise<Document | UploadResponse> {
    const fallbackFilename =
      typeof file !== 'string' && isZipArchive(file) ? 'upload.docx' : 'upload.pdf';
    const { bytes, filename } = await this.loadUploadInput(file, options?.filename, fallbackFilename);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: documentContentType(filename) }), filename);

    if (options?.method) form.append('method', options.method);
    if (options?.collection_id) form.append('collection_id', options.collection_id);

    const created = await this.http.postMultipart<Document>('/api/v1/documents', form);
    if (options?.wait === false) {
      return this.normalizeDocument(created);
    }
    return this.get(created.id, { wait: true });
  }

  async uploadImages(
    files: string[],
    options: ImageUploadOptions & { wait: false },
  ): Promise<Document>;
  async uploadImages(
    files: string[],
    options?: ImageUploadOptions,
  ): Promise<UploadResponse>;
  async uploadImages(
    files: string[],
    options?: ImageUploadOptions,
  ): Promise<Document | UploadResponse> {
    if (files.length === 0) {
      throw new Error('files must contain at least one image path');
    }

    const method = options?.method ?? 'standard';

    const form = new FormData();
    for (const file of files) {
      const { bytes, filename } = await this.loadUploadInput(file, undefined, 'image');
      form.append('files', new Blob([bytes], { type: this.guessImageMimeType(filename) }), filename);
    }

    form.append('method', method);
    if (options?.collection_id) {
      form.append('collection_id', options.collection_id);
    }

    const created = await this.http.postMultipart<Document>('/api/v1/documents/images', form);
    if (options?.wait === false) {
      return this.normalizeDocument(created);
    }
    return this.get(created.id, { wait: true });
  }

  /**
   * List documents with optional filtering and pagination.
   */
  async list(options?: DocumentListOptions): Promise<DocumentListResponse> {
    const response = await this.http.get<DocumentListResponse>('/api/v1/documents', {
      status: options?.status,
      collection_id: options?.collection_id,
      limit: options?.limit,
      offset: options?.offset,
    });
    return {
      ...response,
      documents: response.documents.map((document) => this.normalizeDocument(document)),
    };
  }

  /**
   * Get a single document by ID.
   * Markdown is fetched separately through `markdown(id)`.
   */
  async get(id: string, options: { wait: true }): Promise<UploadResponse>;
  async get(id: string, options?: { wait?: false }): Promise<Document>;
  async get(
    id: string,
    options?: { wait?: boolean },
  ): Promise<Document | UploadResponse> {
    if (options?.wait) {
      return this.waitForUploadedDocument(id);
    }
    return this.normalizeDocument(await this.http.get<Document>(`/api/v1/documents/${id}`));
  }

  /**
   * Download the extracted markdown for a document.
   */
  async markdown(id: string): Promise<string> {
    return this.http.get<string>(`/api/v1/documents/${id}/markdown`);
  }

  /**
   * Rename a document or change its collection assignment.
   * Provide `filename`, `collection_id`, or `remove_collection`.
   */
  async update(id: string, options: DocumentUpdateOptions): Promise<Document> {
    if (options.collection_id !== undefined && options.remove_collection) {
      throw new Error('collection_id and remove_collection cannot be used together');
    }

    const body: Record<string, unknown> = {};
    if (options.filename !== undefined) body.filename = options.filename;
    if (options.collection_id !== undefined) body.collection_id = options.collection_id;
    if (options.remove_collection) body.remove_collection = true;

    if (Object.keys(body).length === 0) {
      throw new Error('update requires filename, collection_id, or remove_collection');
    }

    return this.normalizeDocument(await this.http.patch<Document>(`/api/v1/documents/${id}`, body));
  }

  /**
   * Delete a document.
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/documents/${id}`);
  }

  /**
   * Block until the document finishes parsing and return its markdown payload.
   */
  async waitUntilParsed(id: string): Promise<UploadResponse> {
    return this.waitForUploadedDocument(id);
  }

  /**
   * Block until the method-specific index reaches `indexed`.
   */
  async waitUntilIndexed(
    id: string,
    options?: { method?: IndexMethod },
  ): Promise<IndexResponse> {
    return this.waitForDocumentIndex(id, options?.method ?? 'vector');
  }

  /**
   * Create or rebuild an index on a parsed document.
   */
  async index(id: string, options: IndexCreateOptions): Promise<IndexResponse> {
    const created = this.normalizeIndex(await this.http.post<IndexResponse>(`/api/v1/documents/${id}/indexes`, {
      method: options.method,
    }));
    if (options.wait === false) {
      return created;
    }
    return this.getIndex(id, options.method, { wait: true });
  }

  async listIndexes(id: string): Promise<DocumentIndex[]> {
    const indexes = await this.http.get<DocumentIndex[]>(`/api/v1/documents/${id}/indexes`);
    return indexes.map((index) => this.normalizeIndex(index));
  }

  async getIndex(
    id: string,
    method: 'vector' | 'hybrid',
    options?: { wait?: boolean },
  ): Promise<IndexResponse> {
    if (options?.wait) {
      return this.waitForDocumentIndex(id, method);
    }
    return this.normalizeIndex(await this.http.get<IndexResponse>(`/api/v1/documents/${id}/indexes/${method}`));
  }

  private async waitForUploadedDocument(id: string): Promise<UploadResponse> {
    const deadline = Date.now() + this.http.timeoutMs;

    while (true) {
      const document = await this.get(id);
      if (document.status === 'done' || document.status === 'parsed' || document.status === 'indexed') {
        return {
          id: document.id,
          status: document.status,
          method: document.method,
          filename: document.filename,
          page_count: document.page_count,
          markdown: await this.markdown(id),
          extraction_ms: document.processing_time_ms ?? 0,
          collection_id: document.collection_id,
          extraction_pages: document.extraction_pages,
        };
      }

      if (document.status === 'error') {
        throw new InfratexError(
          document.error_message ?? 'Document processing failed',
          409,
          'document_processing_failed',
        );
      }

      if (Date.now() >= deadline) {
        throw new InfratexError('Document processing timed out', 504, 'upload_timeout');
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private async waitForDocumentIndex(
    id: string,
    method: 'vector' | 'hybrid',
  ): Promise<IndexResponse> {
    const deadline = Date.now() + this.http.timeoutMs;

    while (true) {
      const index = await this.getIndex(id, method);
      if (index.status === 'indexed') {
        return index;
      }

      if (index.status === 'error') {
        throw new InfratexError(
          index.error_message ?? 'Indexing failed',
          409,
          'index_failed',
        );
      }

      if (Date.now() >= deadline) {
        throw new InfratexError('Indexing timed out', 504, 'index_timeout');
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private normalizeIndex<T extends DocumentIndex>(index: T): T {
    return {
      ...index,
      processing_ms: index.processing_ms ?? index.processing_time_ms ?? 0,
    };
  }

  private normalizeDocument(document: Document): Document {
    return {
      ...document,
      indexes: document.indexes?.map((index) => this.normalizeIndex(index)),
    };
  }

  private async loadUploadInput(
    file: string | Buffer,
    explicitFilename: string | undefined,
    fallbackFilename: string,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
    let bytes: Uint8Array<ArrayBuffer>;
    let filename: string;

    if (typeof file === 'string') {
      const data = await readFile(file);
      filename = explicitFilename ?? basename(file);
      bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      return { bytes, filename };
    }

    filename = explicitFilename ?? fallbackFilename;
    bytes = new Uint8Array(file.byteLength);
    bytes.set(file);
    return { bytes, filename };
  }

  private guessImageMimeType(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }
}

function documentContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return DOCX_CONTENT_TYPE;
  // The API identifies the document from its bytes; a neutral type is accepted.
  return 'application/octet-stream';
}

/** A .docx is a ZIP package; a PDF starts with `%PDF`. */
function isZipArchive(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
