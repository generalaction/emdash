type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.agent.canary' : 'com.agent.stable';
export const PRODUCT_NAME = isCanary ? 'Agent Canary' : 'Agent';
export const APP_NAME_LOWER = isCanary ? 'agent-canary' : 'agent';
export const LINUX_DESKTOP_ID = isCanary ? 'agent-canary' : 'Agent';
export const USER_DATA_DIR_NAME = isDev ? 'agent-dev' : isCanary ? 'agent-canary' : 'agent';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'agent-canary' : 'agent';
export const R2_BASE_URL = 'https://releases.emdash.sh';
export const IS_CANARY = isCanary;
