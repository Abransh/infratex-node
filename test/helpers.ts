import type { TestContext } from 'node:test';
import { Infratex } from '../src/index.js';

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: RequestInit['body'];
}

export type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** Replace global fetch for the duration of one test and record every call. */
export function mockFetch(t: TestContext, handler: Handler): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request: RecordedRequest = {
        url: new URL(input instanceof Request ? input.url : String(input)),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body,
      };
      requests.push(request);
      return handler(request);
    },
  );
  return requests;
}

export function createClient(): Infratex {
  return new Infratex({ apiKey: 'infratex_sk_test', baseUrl: 'https://api.test' });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function formOf(request: RecordedRequest): FormData {
  if (!(request.body instanceof FormData)) {
    throw new Error('expected a multipart/form-data body');
  }
  return request.body;
}

export function jsonOf(request: RecordedRequest): unknown {
  if (typeof request.body !== 'string') {
    throw new Error('expected a JSON string body');
  }
  return JSON.parse(request.body);
}

export function last<T>(items: T[]): T {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error('no requests were recorded');
  return item;
}
