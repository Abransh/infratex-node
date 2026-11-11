import { HttpClient } from '../http.js';
import type {
  Webhook,
  WebhookCreated,
  WebhookCreateOptions,
  WebhookDelivery,
  WebhookDeliveryListOptions,
  WebhookDeliveryListResponse,
  WebhookSecretResponse,
  WebhookUpdateOptions,
} from '../types.js';

const MAX_DELIVERY_PAGE = 100;

/**
 * Endpoints that receive a signed JSON event when a parse, an index build or
 * an extraction run finishes or fails. Verify each delivery with
 * `verifyWebhookSignature`.
 */
export class Webhooks {
  constructor(private readonly http: HttpClient) {}

  /**
   * Register a public HTTPS endpoint (up to 10 per account). `events` empty or
   * omitted sends every event type. The result carries the signing `secret`,
   * shown only here and on `rotateSecret`: store it.
   */
  async create(options: WebhookCreateOptions): Promise<WebhookCreated> {
    const body: Record<string, unknown> = { url: options.url };
    if (options.events !== undefined) body.events = options.events;
    if (options.description !== undefined) body.description = options.description;
    return this.http.post<WebhookCreated>('/api/v1/webhooks', body);
  }

  /** List the account's endpoints (without secrets). */
  async list(): Promise<Webhook[]> {
    return this.http.get<Webhook[]>('/api/v1/webhooks');
  }

  /** Get one endpoint (without its secret). */
  async get(id: string): Promise<Webhook> {
    return this.http.get<Webhook>(`/api/v1/webhooks/${id}`);
  }

  /**
   * Change an endpoint; only the options given are sent. `events: []` makes it
   * take every event type, `description: null` removes the description,
   * `enabled: false` pauses deliveries.
   */
  async update(id: string, options: WebhookUpdateOptions): Promise<Webhook> {
    const body: Record<string, unknown> = {};
    if (options.url !== undefined) body.url = options.url;
    if (options.events !== undefined) body.events = options.events;
    if (options.description !== undefined) body.description = options.description;
    if (options.enabled !== undefined) body.enabled = options.enabled;
    if (Object.keys(body).length === 0) {
      throw new Error('update requires url, events, description, or enabled');
    }
    return this.http.patch<Webhook>(`/api/v1/webhooks/${id}`, body);
  }

  /** Remove an endpoint and its delivery log. */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/webhooks/${id}`);
  }

  /** Issue a new signing secret; deliveries from now on are signed with it. */
  async rotateSecret(id: string): Promise<WebhookSecretResponse> {
    return this.http.post<WebhookSecretResponse>(`/api/v1/webhooks/${id}/rotate-secret`);
  }

  /** Queue a `webhook.test` event to the endpoint (60 an hour per account). */
  async test(id: string): Promise<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`/api/v1/webhooks/${id}/test`);
  }

  /** The endpoint's deliveries, newest first, kept 30 days. */
  async listDeliveries(
    id: string,
    options?: WebhookDeliveryListOptions,
  ): Promise<WebhookDeliveryListResponse> {
    const limit = options?.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_DELIVERY_PAGE)) {
      throw new RangeError(`limit must be an integer between 1 and ${MAX_DELIVERY_PAGE}`);
    }
    return this.http.get<WebhookDeliveryListResponse>(`/api/v1/webhooks/${id}/deliveries`, {
      status: options?.status,
      limit,
    });
  }

  /**
   * Send a failed or delivered delivery again, with the same event id and
   * body. The API answers 409 `delivery_pending` while it is still being
   * retried (120 retries an hour per account).
   */
  async retryDelivery(id: string, deliveryId: string): Promise<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(
      `/api/v1/webhooks/${id}/deliveries/${deliveryId}/retry`,
    );
  }
}
