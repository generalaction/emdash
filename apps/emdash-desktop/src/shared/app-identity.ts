type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.emdash.canary' : 'com.emdash.stable';
export const PRODUCT_NAME = isCanary ? 'Emdash Canary' : 'Emdash';
export const APP_NAME_LOWER = isCanary ? 'emdash-canary' : 'emdash';
export const USER_DATA_DIR_NAME = isDev ? 'emdash-dev' : isCanary ? 'emdash-canary' : 'emdash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'emdash-canary' : 'emdash';
export const R2_BASE_URL = 'https://releases.emdash.sh';
