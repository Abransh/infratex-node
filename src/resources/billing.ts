import { HttpClient } from '../http.js';
import type {
  BillingSummaryResponse,
  BillingTransaction,
  BillingTransactionIterateOptions,
  BillingTransactionListOptions,
  BillingTransactionPage,
} from '../types.js';

const MAX_TRANSACTION_PAGE = 500;

export class Billing {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get the billing summary including balance, recent transactions, usage, and spend.
   */
  async get(): Promise<BillingSummaryResponse> {
    return this.http.get<BillingSummaryResponse>('/api/v1/billing');
  }

  /**
   * Fetch one page of the account's credit ledger, newest first.
   *
   * @example
   * ```ts
   * const page = await client.billing.listTransactions({ since: '2026-10-01T00:00:00Z', limit: 100 });
   * const older = page.next_before
   *   ? await client.billing.listTransactions({ before: page.next_before })
   *   : null;
   * ```
   */
  async listTransactions(options?: BillingTransactionListOptions): Promise<BillingTransactionPage> {
    checkPageSize('limit', options?.limit);
    return this.http.get<BillingTransactionPage>('/api/v1/billing/transactions', {
      since: toTimestamp(options?.since),
      until: toTimestamp(options?.until),
      before: toTimestamp(options?.before),
      limit: options?.limit,
    });
  }

  /**
   * Iterate over every transaction in the window, newest first, following
   * `next_before` from page to page. Pages are fetched lazily as the loop advances.
   *
   * @example
   * ```ts
   * for await (const tx of client.billing.iterTransactions({ since: new Date('2026-10-01') })) {
   *   console.log(tx.created_at, tx.amount_micros, tx.description);
   * }
   * ```
   */
  iterTransactions(options?: BillingTransactionIterateOptions): AsyncIterableIterator<BillingTransaction> {
    const pageSize = options?.page_size ?? MAX_TRANSACTION_PAGE;
    checkPageSize('page_size', pageSize);
    return this.paginateTransactions(options?.since, options?.until, pageSize);
  }

  private async *paginateTransactions(
    since: Date | string | undefined,
    until: Date | string | undefined,
    pageSize: number,
  ): AsyncIterableIterator<BillingTransaction> {
    let before: string | undefined;
    while (true) {
      const page = await this.listTransactions({ since, until, before, limit: pageSize });
      yield* page.transactions;
      if (!page.next_before || page.next_before === before) return;
      before = page.next_before;
    }
  }
}

function toTimestamp(value: Date | string | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

function checkPageSize(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TRANSACTION_PAGE) {
    throw new RangeError(`${name} must be an integer between 1 and ${MAX_TRANSACTION_PAGE}`);
  }
}
