import { BinaryResponse, HttpClient, IDEMPOTENCY_HEADER, InfratexError } from '../http.js';
import {
  documentContentType,
  fallbackDocumentFilename,
  imageContentType,
  loadUploadInput,
} from '../files.js';
import type {
  Document,
  DocumentFiguresResponse,
  DocumentIndex,
  DocumentLayout,
  DocumentListOptions,
  DocumentListResponse,
  DocumentProgress,
  DocumentUpdateOptions,
  ImageUploadOptions,
  IndexCreateOptions,
  IndexMethod,
  IndexResponse,
  MarkdownOptions,
  UploadOptions,
  UploadResponse,
  WaitUntilParsedOptions,
} from '../types.js';

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
    const { bytes, filename } = await loadUploadInput(
      file,
      options?.filename,
      fallbackDocumentFilename(file),
    );
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: documentContentType(filename) }), filename);

    if (options?.method) form.append('method', options.method);
    if (options?.table_format) form.append('table_format', options.table_format);
    if (options?.options !== undefined) form.append('options', JSON.stringify(options.options));
    if (options?.collection_id) form.append('collection_id', options.collection_id);

    const created = await this.http.postMultipart<Document>('/api/v1/documents', form, {
      [IDEMPOTENCY_HEADER]: options?.idempotency_key,
    });
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
      const { bytes, filename } = await loadUploadInput(file, undefined, 'image');
      form.append('files', new Blob([bytes], { type: imageContentType(filename) }), filename);
    }

    form.append('method', method);
    if (options?.table_format) {
      form.append('table_format', options.table_format);
    }
    if (options?.options !== undefined) {
      form.append('options', JSON.stringify(options.options));
    }
    if (options?.collection_id) {
      form.append('collection_id', options.collection_id);
    }

    const created = await this.http.postMultipart<Document>('/api/v1/documents/images', form, {
      [IDEMPOTENCY_HEADER]: options?.idempotency_key,
    });
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
   *
   * @example
   * ```ts
   * const markdown = await client.documents.markdown('doc-id');
   * const withHtmlTables = await client.documents.markdown('doc-id', { table_format: 'html' });
   * ```
   */
  async markdown(id: string, options?: MarkdownOptions): Promise<string> {
    const figureDescriptions = options?.figure_descriptions;
    return this.http.get<string>(`/api/v1/documents/${id}/markdown`, {
      table_format: options?.table_format,
      figure_descriptions: figureDescriptions === undefined ? undefined : String(figureDescriptions),
    });
  }

  /**
   * Bounding boxes of a document parsed with `infratex-gamma`: per page, its
   * regions with label, `bbox` in pixels of a page image of the page's
   * `width` x `height`, and recognised text. Other methods answer 404
   * `layout_not_available`; 409 while parsing.
   */
  async layout(id: string): Promise<DocumentLayout> {
    return this.http.get<DocumentLayout>(`/api/v1/documents/${id}/layout`);
  }

  /**
   * List the figures cropped from a parsed PDF: page, type, detection score,
   * bounding box in PDF points and the `src` its figure block in the Markdown
   * carries. Empty when the document has no figures or they could not be
   * matched reliably.
   */
  async listFigures(id: string): Promise<DocumentFiguresResponse> {
    return this.http.get<DocumentFiguresResponse>(`/api/v1/documents/${id}/figures`);
  }

  /**
   * Download one cropped figure as PNG bytes.
   *
   * `name` is a figure's `name` (`p12-1.png`); its `src` (`figures/p12-1.png`)
   * is accepted too.
   *
   * @example
   * ```ts
   * const { figures } = await client.documents.listFigures('doc-id');
   * for (const figure of figures) {
   *   const png = await client.documents.downloadFigure('doc-id', figure.name);
   *   await png.save(figure.name);
   * }
   * ```
   */
  async downloadFigure(id: string, name: string): Promise<BinaryResponse> {
    const filename = name.slice(name.lastIndexOf('/') + 1);
    const response = await this.http.getBinary(
      `/api/v1/documents/${id}/figures/${encodeURIComponent(filename)}`,
    );
    return new BinaryResponse(
      response.content,
      response.filename ?? filename,
      response.contentType,
    );
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
   *
   * Throws an `InfratexError` with the document's `error_message` (code
   * `document_processing_failed`) when the parse fails, and code
   * `upload_timeout` when the client `timeout` runs out first; both carry the
   * document id, and the timeout the last progress, in `details`.
   *
   * @example
   * ```ts
   * await client.documents.waitUntilParsed(doc.id, {
   *   onProgress: (p) => console.log(p.stage, `${p.pages_done}/${p.pages_total ?? '?'}`),
   * });
   * ```
   */
  async waitUntilParsed(id: string, options?: WaitUntilParsedOptions): Promise<UploadResponse> {
    return this.waitForUploadedDocument(id, options?.onProgress);
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
    const created = this.normalizeIndex(await this.http.post<IndexResponse>(
      `/api/v1/documents/${id}/indexes`,
      { method: options.method },
      { [IDEMPOTENCY_HEADER]: options.idempotency_key },
    ));
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

  private async waitForUploadedDocument(
    id: string,
    onProgress?: (progress: DocumentProgress) => void,
  ): Promise<UploadResponse> {
    const deadline = Date.now() + this.http.timeoutMs;
    let lastProgress: DocumentProgress | null = null;

    while (true) {
      const document = await this.get(id);
      const progress = document.progress ?? null;
      if (progress !== null && !sameProgress(progress, lastProgress)) {
        lastProgress = progress;
        onProgress?.(progress);
      }
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
          { document_id: id },
        );
      }

      if (Date.now() >= deadline) {
        throw new InfratexError('Document processing timed out', 504, 'upload_timeout', {
          document_id: id,
          progress: lastProgress,
        });
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
}

const PROGRESS_FIELDS = [
  'stage',
  'pages_done',
  'pages_total',
  'attempt',
  'max_attempts',
  'updated_at',
] as const satisfies readonly (keyof DocumentProgress)[];

function sameProgress(a: DocumentProgress, b: DocumentProgress | null): boolean {
  return b !== null && PROGRESS_FIELDS.every((field) => a[field] === b[field]);
}
