import type { Env } from '../../../env';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class D1RequestError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`D1 request failed: ${status}`);
  }
}

export class D1Client {
  constructor(private accountId: string, private token: string) {}

  public static fromEnv(env: Env): D1Client {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      throw new Error('missing D1 environment configuration');
    }
    return new D1Client(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN);
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = { ...this.headers };
    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new D1RequestError(response.status, payload);
    }
    return payload as T;
  }

  public listDatabases() {
    return this.request(`/accounts/${this.accountId}/d1/database`, 'GET');
  }

  public getDatabase(databaseId: string) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}`, 'GET');
  }

  public createDatabase(payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database`, 'POST', payload);
  }

  public updateDatabase(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}`, 'PUT', payload);
  }

  public patchDatabase(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}`, 'PATCH', payload);
  }

  public deleteDatabase(databaseId: string) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}`, 'DELETE');
  }

  public queryDatabase(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}/query`, 'POST', payload);
  }

  public rawDatabase(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}/raw`, 'POST', payload);
  }

  public startExport(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}/export`, 'POST', payload);
  }

  public startImport(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}/import`, 'POST', payload);
  }

  public getBookmark(databaseId: string) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}/time_travel/bookmark`, 'GET');
  }

  public restoreBookmark(databaseId: string, payload: unknown) {
    return this.request(`/accounts/${this.accountId}/d1/database/${databaseId}/time_travel/restore`, 'POST', payload);
  }
}
