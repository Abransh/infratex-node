import { writeFile } from 'node:fs/promises';
import type { InfratexErrorBody } from './types.js';
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
// Custom error class
// ---------------------------------------------------------------------------

export class InfratexError extends Error {
  /** HTTP status code (e.g. 401, 404, 422, 500). */
  readonly status: number;
  /** Machine-readable error code from the API (e.g. `invalid_pdf`). */
  readonly code: string | undefined;
  /** Additional details returned by the API. */
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'InfratexError';
    this.status = status;
    this.code = code;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, InfratexError.prototype);
  }
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

    // Attempt to parse structured error body
    let body: InfratexErrorBody = {};
    try {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        body = (await res.json()) as InfratexErrorBody;
      } else {
        const text = await res.text();
        body = { message: text };
      }
    } catch {
      // ignore parse failures
    }

    throw new InfratexError(
      body.message ?? `Request failed with status ${res.status}`,
      res.status,
      body.code,
      body.details,
    );
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

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
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

  async postMultipart<T>(path: string, formData: FormData): Promise<T> {
    // Do NOT set Content-Type — fetch will auto-set multipart/form-data with boundary
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers(),
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
      let errBody: InfratexErrorBody = {};
      try {
        errBody = (await res.json()) as InfratexErrorBody;
      } catch {
        // ignore
      }
      throw new InfratexError(
        errBody.message ?? `Request failed with status ${res.status}`,
        res.status,
        errBody.code,
        errBody.details,
      );
    }

    return res;
  }
}
