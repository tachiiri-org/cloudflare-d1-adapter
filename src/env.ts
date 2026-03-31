import type { Fetcher } from '@cloudflare/workers-types';
import type { Env as HonoEnv } from 'hono';

export interface Env extends HonoEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  ENV: string;
  INTERNAL_GATEWAY_SERVICE?: Fetcher;
}
