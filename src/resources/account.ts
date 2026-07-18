import { HttpClient } from '../http.js';
import type { AccountResponse, AccountSettings } from '../types.js';

export class Account {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get the current account (tenant + credit balance) details.
   */
  async get(): Promise<AccountResponse> {
    return this.http.get<AccountResponse>('/api/v1/account');
  }

  /**
   * Get account billing settings (overage, spend cap, thresholds).
   */
  async settings(): Promise<AccountSettings> {
    return this.http.get<AccountSettings>('/api/v1/account/settings');
  }
}
