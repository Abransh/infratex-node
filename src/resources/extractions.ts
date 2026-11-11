import { BinaryResponse, HttpClient, IDEMPOTENCY_HEADER, InfratexError } from '../http.js';
import { fallbackDocumentFilename, loadUploadInput, uploadContentType } from '../files.js';
import type {
  ExtractionCreateOptions,
  ExtractionExportOptions,
  ExtractionFromFileOptions,
  ExtractionGetOptions,
  ExtractionListOptions,
  ExtractionPipelinesResponse,
  ExtractionRun,
  ExtractionRunListResponse,
} from '../types.js';

/** Longest server-side `wait` the API accepts, in seconds. */
const MAX_WAIT_SECONDS = 300;

/**
 * Structured field extraction from parsed documents.
 *
 * Supply either inline field definitions (`inline_fields`) or reference a
 * template created in the dashboard (`template_id`) — exactly one is required.
 * Extraction *templates* are managed from the dashboard; the public API can
 * reference a template by id but cannot create or list templates.
 */
export class Extractions {
  private readonly pollIntervalMs = 1500;

  constructor(private readonly http: HttpClient) {}

  /**
   * Queue an extraction run against a parsed document.
   *
   * @example
   * ```ts
   * const run = await client.extractions.create({
   *   document_id: 'doc_123',
   *   model: 'fast',
   *   include_evidence: true,
   *   inline_fields: [
   *     { name: 'counterparty', type: 'string', description: 'Legal name of the counterparty' },
   *   ],
   * });
   * const result = await client.extractions.waitUntilDone(run.id, { include_evidence: true });
   * ```
   */
  async create(options: ExtractionCreateOptions): Promise<ExtractionRun> {
    return this.http.post<ExtractionRun>(
      `/api/v1/documents/${options.document_id}/extractions`,
      runBody(options),
      { [IDEMPOTENCY_HEADER]: options.idempotency_key },
    );
  }

  /**
   * Upload a file, parse it and extract fields from it in one call
   * (`POST /api/v1/extractions`): the run starts as soon as the parse ends.
   * Parse and extraction are billed as usual; if the balance cannot cover
   * both, the API answers 402 and nothing is created.
   *
   * Accepts a PDF, a `.docx`, or one PNG, JPEG or WebP image, as a path or a
   * Buffer (pass `filename` with a Buffer).
   *
   * @example
   * ```ts
   * const run = await client.extractions.createFromFile('./contract.pdf', {
   *   model: 'pro',
   *   inline_fields: [{ name: 'counterparty', type: 'string', description: 'Legal name' }],
   *   wait: 180,
   * });
   * const done = run.status === 'done' ? run : await client.extractions.waitUntilDone(run.id);
   * ```
   */
  async createFromFile(
    file: string | Buffer,
    options: ExtractionFromFileOptions,
  ): Promise<ExtractionRun> {
    const body = runBody(options);
    checkWait(options.wait);
    const { bytes, filename } = await loadUploadInput(
      file,
      options.filename,
      fallbackDocumentFilename(file),
    );
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: uploadContentType(filename) }), filename);
    form.append('extraction', JSON.stringify(body));
    if (options.method) form.append('method', options.method);
    if (options.wait !== undefined) form.append('wait', String(options.wait));

    return this.http.postMultipart<ExtractionRun>('/api/v1/extractions', form, {
      [IDEMPOTENCY_HEADER]: options.idempotency_key,
    });
  }

  /**
   * Retrieve a single extraction run by ID. `wait` (0 to 300 s) asks the
   * server to hold the request until the run is `done` or `error`.
   */
  async get(runId: string, options?: ExtractionGetOptions): Promise<ExtractionRun> {
    checkWait(options?.wait);
    return this.http.get<ExtractionRun>(`/api/v1/extractions/${runId}`, {
      include_evidence: options?.include_evidence ? 'true' : undefined,
      wait: options?.wait,
    });
  }

  /**
   * The extraction pipelines and whether this account may choose each
   * (`GET /api/v1/extraction-pipelines`). `legacy` is always available; `v2`
   * (beta) once the beta is open for the account.
   */
  async listPipelines(): Promise<ExtractionPipelinesResponse> {
    return this.http.get<ExtractionPipelinesResponse>('/api/v1/extraction-pipelines');
  }

  /** List prior extraction runs for a document. */
  async list(
    documentId: string,
    options?: ExtractionListOptions,
  ): Promise<ExtractionRunListResponse> {
    return this.http.get<ExtractionRunListResponse>(
      `/api/v1/documents/${documentId}/extractions`,
      {
        limit: options?.limit,
        offset: options?.offset,
        include_evidence: options?.include_evidence ? 'true' : undefined,
      },
    );
  }

  /** Poll an extraction run until it reaches `done` (or throw on `error`). */
  async waitUntilDone(
    runId: string,
    options?: Pick<ExtractionGetOptions, 'include_evidence'>,
  ): Promise<ExtractionRun> {
    const deadline = Date.now() + this.http.timeoutMs;

    while (true) {
      const run = await this.get(runId, { include_evidence: options?.include_evidence });
      if (run.status === 'done') {
        return run;
      }
      if (run.status === 'error') {
        throw new InfratexError(
          run.error_message ?? 'Extraction failed',
          409,
          'extraction_failed',
        );
      }
      if (Date.now() >= deadline) {
        throw new InfratexError('Extraction timed out', 504, 'extraction_timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  /**
   * Download a completed run's tabular fields as `csv` or `xlsx`.
   * Only available when the result contains `array<object>` fields.
   */
  async export(runId: string, options?: ExtractionExportOptions): Promise<BinaryResponse> {
    return this.http.getBinary(`/api/v1/extractions/${runId}/export`, {
      format: options?.format ?? 'xlsx',
    });
  }
}

function runBody(options: Omit<ExtractionCreateOptions, 'document_id'>): Record<string, unknown> {
  const hasInline = options.inline_fields !== undefined;
  const hasTemplate = options.template_id !== undefined;
  if (hasInline === hasTemplate) {
    throw new Error('provide exactly one of inline_fields or template_id');
  }
  if (options.inline_system_prompt !== undefined && !hasInline) {
    throw new Error('inline_system_prompt is only valid with inline_fields');
  }

  const body: Record<string, unknown> = {
    model: options.model ?? 'fast',
    include_evidence: options.include_evidence ?? false,
  };
  if (options.inline_fields !== undefined) body.inline_fields = options.inline_fields;
  if (options.template_id !== undefined) body.template_id = options.template_id;
  if (options.inline_system_prompt !== undefined) {
    body.inline_system_prompt = options.inline_system_prompt;
  }
  if (options.completeness !== undefined) body.completeness = options.completeness;
  if (options.pipeline !== undefined) body.pipeline = options.pipeline;
  return body;
}

function checkWait(wait: number | undefined): void {
  if (wait === undefined) return;
  if (!Number.isInteger(wait) || wait < 0 || wait > MAX_WAIT_SECONDS) {
    throw new RangeError(`wait must be an integer between 0 and ${MAX_WAIT_SECONDS} seconds`);
  }
}
