type ImportMetaWithEnv = ImportMeta & { env?: { VITE_BUILD?: string } };

const isCanary = (import.meta as ImportMetaWithEnv).env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.rundash.canary' : 'com.rundash.stable';
export const PRODUCT_NAME = isCanary ? 'Rundash Canary' : 'Rundash';
export const APP_NAME_LOWER = isCanary ? 'rundash-canary' : 'rundash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'rundash-canary' : 'rundash';
export const R2_BASE_URL = 'https://releases.rundash.dev';
