import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export const SIGNATURE_HEADER = 'Infratex-Signature';
/** Header carrying the event id, the same on every retry: deduplicate on it. */
export const EVENT_ID_HEADER = 'Infratex-Event-Id';

const DEFAULT_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookSignatureOptions {
  /** Largest accepted distance between the signature's timestamp and `now`, in seconds. Default 300. */
  tolerance?: number;
  /** The current time in Unix seconds. Defaults to the system clock. */
  now?: number;
}

/**
 * Whether `header` is a valid, recent `Infratex-Signature` of `body`.
 *
 * Pass the raw request body exactly as received (before any JSON parsing)
 * and the endpoint's `whsec_...` secret. The digest is compared in constant
 * time, and a timestamp more than `tolerance` seconds from `now` is rejected,
 * so a captured delivery cannot be replayed later.
 *
 * @example
 * ```ts
 * app.post('/infratex', express.raw({ type: 'application/json' }), (req, res) => {
 *   if (!verifyWebhookSignature(SECRET, req.body, req.get('Infratex-Signature') ?? '')) {
 *     return res.status(400).end();
 *   }
 *   res.status(200).end();
 * });
 * ```
 */
export function verifyWebhookSignature(
  secret: string,
  body: string | Uint8Array,
  header: string,
  options?: VerifyWebhookSignatureOptions,
): boolean {
  const fields = new Map<string, string[]>();
  for (const part of header.split(',')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    const name = separator === -1 ? trimmed : trimmed.slice(0, separator);
    const value = separator === -1 ? '' : trimmed.slice(separator + 1);
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }

  const rawTimestamp = fields.get('t')?.[0] ?? '';
  if (!/^[+-]?\d+$/.test(rawTimestamp.trim())) return false;
  const timestamp = Number(rawTimestamp);
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options?.tolerance ?? DEFAULT_TOLERANCE_SECONDS)) return false;

  const raw = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), raw]))
      .digest('hex'),
  );
  return (fields.get('v1') ?? []).some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
