import { PRODUCT_NAME } from '../../../src/shared/app-identity.ts';

export {
  APP_ID,
  APP_NAME_LOWER,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from '../../../src/shared/app-identity.ts';

export const APP_BUNDLE = `${PRODUCT_NAME}.app`;
export const APP_BINARY = PRODUCT_NAME;
export const RELEASE_DIR = 'release';
export const NATIVE_MODULES = ['sqlite3', 'node-pty', 'keytar'];

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function r2Endpoint(): string {
  return `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${requireEnv('R2_BUCKET')}`;
}
