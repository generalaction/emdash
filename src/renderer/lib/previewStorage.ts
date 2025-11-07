export const LAST_URL_KEY = (id: string) => `emdash:browser:lastUrl:${id}`;
export const RUNNING_KEY = (id: string) => `emdash:preview:running:${id}`;
export const INSTALLED_KEY = (id: string) => `emdash:preview:installed:${id}`;

export function getLastUrl(id: string): string | null {
  try { return localStorage.getItem(LAST_URL_KEY(id)); } catch { return null; }
}
export function setLastUrl(id: string, url: string): void {
  try { localStorage.setItem(LAST_URL_KEY(id), url); } catch {}
}
export function isRunning(id: string): boolean {
  try { return localStorage.getItem(RUNNING_KEY(id)) === '1'; } catch { return false; }
}
export function setRunning(id: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(RUNNING_KEY(id), '1'); else localStorage.removeItem(RUNNING_KEY(id));
  } catch {}
}
export function isInstalled(id: string): boolean {
  try { return localStorage.getItem(INSTALLED_KEY(id)) === '1'; } catch { return false; }
}
export function setInstalled(id: string, on: boolean): void {
  try { if (on) localStorage.setItem(INSTALLED_KEY(id), '1'); else localStorage.removeItem(INSTALLED_KEY(id)); } catch {}
}
export function clear(id: string): void {
  try {
    localStorage.removeItem(LAST_URL_KEY(id));
    localStorage.removeItem(RUNNING_KEY(id));
    localStorage.removeItem(INSTALLED_KEY(id));
  } catch {}
}

