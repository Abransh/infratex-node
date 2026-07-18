import { HttpClient } from './http.js';
import type { InfratexConfig } from './types.js';
import { Documents } from './resources/documents.js';
import { Searches } from './resources/searches.js';
import { Responses } from './resources/responses.js';
import { Extractions } from './resources/extractions.js';
import { Collections } from './resources/collections.js';
import { Conversations } from './resources/conversations.js';
import { Account } from './resources/account.js';
import { Billing } from './resources/billing.js';

const DEFAULT_BASE_URL = 'https://api.infratex.io';
const DEFAULT_TIMEOUT = 300_000; // 5 minutes

export class Infratex {
  readonly documents: Documents;
  readonly searches: Searches;
  readonly responses: Responses;
  readonly extractions: Extractions;
  readonly collections: Collections;
  readonly conversations: Conversations;
  readonly account: Account;
  readonly billing: Billing;

  constructor(config: InfratexConfig) {
    if (!config.apiKey) {
      throw new Error(
        'Missing apiKey. Pass it via `new Infratex({ apiKey: "infratex_sk_..." })` ' +
          'or set the INFRATEX_API_KEY environment variable.',
      );
    }

    const http = new HttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    });

    this.documents = new Documents(http);
    this.searches = new Searches(http);
    this.responses = new Responses(http);
    this.extractions = new Extractions(http);
    this.collections = new Collections(http);
    this.conversations = new Conversations(http);
    this.account = new Account(http);
    this.billing = new Billing(http);
  }
}
