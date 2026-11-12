import { writeFile } from 'node:fs/promises';
import { SDK_VERSION } from './version.js';

// ---------------------------------------------------------------------------
// Binary response (file downloads, e.g. extraction exports)
// ---------------------------------------------------------------------------

export class BinaryResponse {
  /** Raw file bytes. */
  readonly content: Uint8Array;
  /** Suggested filename parsed from the Content-Disposition header, if present. */
  readonly filename: string | undefined;
  /** MIME type from the Content-Type header, if present. */
  readonly contentType: string | undefined;

  constructor(content: Uint8Array, filename?: string, contentType?: string) {
    this.content = content;
    this.filename = filename;
    this.contentType = contentType;
  }

  /** Write the payload to `path` and return the path written. */
  async save(path: string): Promise<string> {
    await writeFile(path, this.content);
    return path;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface InfratexErrorOptions {
  /** The request's id (`X-Request-ID`), for support conversations. */
  requestId?: string;
  /** The `Retry-After` header in seconds (429, 409 `idempotency_request_in_progress`). */
  retryAfter?: number;
}

export class InfratexError extends Error {
  /** HTTP status code (e.g. 401, 404, 422, 500). */
  readonly status: number;
  /** Machine-readable error code from the API (e.g. `invalid_pdf`). */
  readonly code: string | undefined;
  /**
   * Additional details returned by the API. For a request validation error
   * (`validation_error`) the API's list of field errors is under `details.errors`.
   */
  readonly details: Record<string, unknown> | undefined;
  /** The request's id (`X-Request-ID`), for support conversations. */
  readonly requestId: string | undefined;
  /** The `Retry-After` header in seconds, when the API sent one. */
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message);
    this.name = 'InfratexError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = options?.requestId;
    this.retryAfter = options?.retryAfter;

    // Maintain the prototype chain (subclasses included) for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 422 `invalid_pipeline`: an extraction run's `pipeline` is not `legacy` or
 * `v2`. Nothing was created or billed.
 */
export class InvalidPipelineError extends InfratexError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'InvalidPipelineError';
  }

  /** The values `pipeline` accepts. */
  get allowedPipelines(): string[] {
    return stringList(this.details?.allowed_pipelines);
  }
}

/**
 * 422 `pipeline_not_available`: the run asks for `pipeline: 'v2'` (beta),
 * which is not open for this account yet. Omit `pipeline` or send `legacy`;
 * `extractions.listPipelines()` shows what the account can choose. Nothing
 * was created or billed.
 */
export class PipelineNotAvailableError extends InfratexError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'PipelineNotAvailableError';
  }

  get requestedPipeline(): string | undefined {
    const value = this.details?.requested_pipeline;
    return typeof value === 'string' ? value : undefined;
  }

  get availablePipelines(): string[] {
    return stringList(this.details?.available_pipelines);
  }
}

/**
 * 400 `encrypted_pdf`: the uploaded PDF needs a password to open, so its pages
 * cannot be read. Remove the password and upload it again. Refused before any
 * credits are held. A PDF with only an owner password is accepted.
 */
export class EncryptedPdfError extends InfratexError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'EncryptedPdfError';
  }
}

/**
 * Base of the upload refusals that list the valid values in
 * `details.allowed`: the `engine_version` and `speed` errors.
 */
export class AllowedValuesError extends InfratexError {
  /** The valid values the API listed in `details.allowed`; empty when it sent none. */
  get allowed(): string[] {
    return stringList(this.details?.allowed);
  }
}

/**
 * 422 `invalid_engine_version`: the upload's `engine_version` is not one the
 * API knows. `allowed` lists the versions it accepts.
 */
export class InvalidEngineVersionError extends AllowedValuesError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'InvalidEngineVersionError';
  }
}

/**
 * 422 `engine_version_not_supported`: `engine_version` was sent with a parse
 * method that has no engine versions to choose from. Only `standard-ultra-2`
 * takes it.
 */
export class EngineVersionNotSupportedError extends AllowedValuesError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'EngineVersionNotSupportedError';
  }
}

/**
 * 422 `invalid_speed`: the upload's `speed` is not `standard` or `fast`.
 * `allowed` lists the speeds the API accepts.
 */
export class InvalidSpeedError extends AllowedValuesError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'InvalidSpeedError';
  }
}

/**
 * 422 `speed_not_supported`: `speed: 'fast'` was sent with a parse method that
 * has no fast speed. Only `standard-ultra-2` takes it.
 */
export class SpeedNotSupportedError extends AllowedValuesError {
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
    options?: InfratexErrorOptions,
  ) {
    super(message, status, code, details, options);
    this.name = 'SpeedNotSupportedError';
  }
}

type InfratexErrorClass = new (
  message: string,
  status: number,
  code?: string,
  details?: Record<string, unknown>,
  options?: InfratexErrorOptions,
) => InfratexError;

const ERRORS_BY_CODE: Record<string, InfratexErrorClass> = {
  invalid_pipeline: InvalidPipelineError,
  pipeline_not_available: PipelineNotAvailableError,
  encrypted_pdf: EncryptedPdfError,
  invalid_engine_version: InvalidEngineVersionError,
  engine_version_not_supported: EngineVersionNotSupportedError,
  invalid_speed: InvalidSpeedError,
  speed_not_supported: SpeedNotSupportedError,
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The `InfratexError` (or typed subclass) for an error response.
 *
 * The API answers `{"error": {"code", "message", "details", "request_id"}}`;
 * the older top-level `{"code", "message", "details"}` and `{"detail": ...}`
 * shapes are read too.
 */
export async function errorFromResponse(res: Response): Promise<InfratexError> {
  let body: unknown;
  let text = '';
  try {
    text = await res.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  let message: string | undefined = isRecord(body) ? undefined : nonEmptyString(text);
  let code: string | undefined;
  let rawDetails: unknown;
  let requestId = res.headers.get('x-request-id') ?? undefined;

  if (isRecord(body)) {
    let payload: Record<string, unknown> = body;
    if (isRecord(body.error)) payload = body.error;
    else if (isRecord(body.detail)) payload = body.detail;
    else if (typeof body.detail === 'string') payload = { message: body.detail };
    message = nonEmptyString(payload.message);
    code = nonEmptyString(payload.code);
    rawDetails = payload.details;
    requestId = nonEmptyString(payload.request_id) ?? requestId;
  }

  const details =
    rawDetails === undefined || rawDetails === null
      ? undefined
      : isRecord(rawDetails)
        ? rawDetails
        : { errors: rawDetails };
  const retryHeader = res.headers.get('retry-after');
  const retryAfter = retryHeader !== null && retryHeader.trim() !== '' ? Number(retryHeader) : NaN;

  const ErrorClass = (code && ERRORS_BY_CODE[code]) || InfratexError;
  return new ErrorClass(message ?? `Request failed with status ${res.status}`, res.status, code, details, {
    requestId,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
  });
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeout = options.timeout;
  }

  get timeoutMs(): number {
    return this.timeout;
  }

  // -- helpers --------------------------------------------------------------

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': `infratex-node/${SDK_VERSION}`,
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (res.ok) {
      // 204 No Content
      if (res.status === 204) return undefined as T;

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      // text/markdown, text/plain, etc.
      return (await res.text()) as T;
    }

    throw await errorFromResponse(res);
  }

  // -- public methods -------------------------------------------------------

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.url(path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    return this.handleResponse<T>(res);
  }

  async post<T>(path: string, body?: unknown, headers?: RequestHeaders): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', ...definedHeaders(headers) }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });
    return this.handleResponse<T>(res);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'PATCH',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });
    return this.handleResponse<T>(res);
  }

  async delete<T = void>(path: string): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    return this.handleResponse<T>(res);
  }

  async getBinary(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<BinaryResponse> {
    const url = new URL(this.url(path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      // Reuse the JSON error path
      return this.handleResponse<BinaryResponse>(res);
    }

    const buffer = new Uint8Array(await res.arrayBuffer());
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return new BinaryResponse(
      buffer,
      match?.[1],
      res.headers.get('content-type') ?? undefined,
    );
  }

  async postMultipart<T>(path: string, formData: FormData, headers?: RequestHeaders): Promise<T> {
    // Do NOT set Content-Type — fetch will auto-set multipart/form-data with boundary
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers(definedHeaders(headers)),
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    });
    return this.handleResponse<T>(res);
  }

  /**
   * POST that returns the raw Response for SSE streaming.
   * Throws InfratexError if the response is not 2xx.
   */
  async postStream(path: string, body: unknown): Promise<Response> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      // No timeout for streaming — the caller controls lifetime
    });

    if (!res.ok) {
      throw await errorFromResponse(res);
    }

    return res;
  }
}

/** Extra request headers; `undefined` values are left out. */
export type RequestHeaders = Record<string, string | undefined>;

function definedHeaders(headers: RequestHeaders | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
