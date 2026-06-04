import { app } from 'electron';

export const SHARE_CONFIG = {
  timeoutMs: 15_000,
};

export function getShareBaseUrl(): string {
  return process.env.EMDASH_SHARE_BASE_URL ?? getDefaultShareBaseUrl();
}

function getDefaultShareBaseUrl(): string {
  const isDevRuntime =
    app?.isPackaged === false ||
    import.meta.env.DEV ||
    process.env.NODE_ENV === 'development' ||
    process.env.ELECTRON_RENDERER_URL !== undefined ||
    process.env.EMDASH_DB_FILE !== undefined;

  return isDevRuntime ? 'http://localhost:8787' : 'https://share.emdash.sh';
}
