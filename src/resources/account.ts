import { HttpClient } from '../http.js';
import type { AccountResponse, AccountSettings, AccountSettingsUpdateOptions } from '../types.js';

export class Account {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get the current account (tenant + credit balance) details.
   */
  async get(): Promise<AccountResponse> {
    return this.http.get<AccountResponse>('/api/v1/account');
  }

  /**
   * Get account settings (overage, spend cap, thresholds, data residency).
   */
  async settings(): Promise<AccountSettings> {
    return this.http.get<AccountSettings>('/api/v1/account/settings');
  }

  /**
   * Set where the account's requests may be processed.
   *
   * An API key may change only `data_residency` (the billing settings are
   * dashboard-only). It may switch the account to `eu_only`, but switching an
   * EU-only account back to `default` is dashboard-only: the API answers 403
   * `dashboard_only`. A change applies from the next request.
   */
  async updateSettings(options: AccountSettingsUpdateOptions): Promise<AccountSettings> {
    return this.http.patch<AccountSettings>('/api/v1/account/settings', {
      data_residency: options.data_residency,
    });
  }
}
