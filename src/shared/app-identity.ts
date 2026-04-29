type ImportMetaWithEnv = ImportMeta & { env?: { VITE_BUILD?: string } };

const isCanary = (import.meta as ImportMetaWithEnv).env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.emdash.canary' : 'com.emdash.stable';
export const PRODUCT_NAME = isCanary ? 'Emdash Canary' : 'Emdash';
export const APP_NAME_LOWER = isCanary ? 'emdash-canary' : 'emdash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'emdash-canary' : 'emdash';
export const R2_BASE_URL = 'https://releases.emdash.sh';
