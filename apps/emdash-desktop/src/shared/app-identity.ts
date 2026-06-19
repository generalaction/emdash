type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.getrocky.canary' : 'com.getrocky.stable';
export const PRODUCT_NAME = isCanary ? 'Rocky Canary' : 'Rocky';
export const APP_NAME_LOWER = isCanary ? 'rocky-canary' : 'rocky';
export const USER_DATA_DIR_NAME = isDev ? 'rocky-dev' : isCanary ? 'rocky-canary' : 'rocky';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'rocky-canary' : 'rocky';
export const R2_BASE_URL = 'https://releases.emdash.sh';
export const IS_CANARY = isCanary;
