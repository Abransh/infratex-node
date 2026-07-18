import { BinaryResponse, HttpClient, InfratexError } from '../http.js';
import type {
  ExtractionCreateOptions,
  ExtractionExportOptions,
  ExtractionGetOptions,
  ExtractionListOptions,
  ExtractionRun,
  ExtractionRunListResponse,
} from '../types.js';

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

    return this.http.post<ExtractionRun>(
      `/api/v1/documents/${options.document_id}/extractions`,
      body,
    );
  }

  /** Retrieve a single extraction run by ID. */
  async get(runId: string, options?: ExtractionGetOptions): Promise<ExtractionRun> {
    return this.http.get<ExtractionRun>(`/api/v1/extractions/${runId}`, {
      include_evidence: options?.include_evidence ? 'true' : undefined,
    });
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
    options?: ExtractionGetOptions,
  ): Promise<ExtractionRun> {
    const deadline = Date.now() + this.http.timeoutMs;

    while (true) {
      const run = await this.get(runId, options);
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
