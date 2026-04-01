import type { Fetcher } from '@cloudflare/workers-types';

export interface EnvBindings {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_D1_TOKEN: string;
  ENV: string;
  INTERNAL_GATEWAY_SERVICE?: Fetcher;
}

export interface Env {
  Bindings: EnvBindings;
}
