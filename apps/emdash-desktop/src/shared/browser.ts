export const BROWSER_PARTITION_PREFIX = 'persist:emdash-browser';

export type BrowserNavigationProtocol = 'about:' | 'file:' | 'http:' | 'https:';

export type BrowserUrlNormalizeResult =
  | { ok: true; url: string; protocol: BrowserNavigationProtocol }
  | { ok: false; reason: BrowserUrlRejectionReason };

export type BrowserUrlRejectionReason =
  | 'empty'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'unsupported-file-url';

export type BrowserSessionIdentity = {
  browserId: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
};

export type BrowserLoadError = {
  code?: number;
  description: string;
  url?: string;
};

export type BrowserSessionSnapshot = BrowserSessionIdentity & {
  partition: string;
  currentUrl: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  loadError?: BrowserLoadError;
  createdAt: number;
  updatedAt: number;
};

export type BrowserSessionRestoreInput = Omit<BrowserSessionSnapshot, 'zoomFactor'> & {
  zoomFactor?: number;
};

export type BrowserDataClearKind = 'storage' | 'cookies' | 'cache';

export function isBrowserDataClearKind(kind: string): kind is BrowserDataClearKind {
  return kind === 'storage' || kind === 'cookies' || kind === 'cache';
}

export type BrowserDiagnosticsLevel = 'info' | 'warning' | 'error';

export type BrowserDiagnosticsEntry = {
  id: string;
  browserId: string;
  level: BrowserDiagnosticsLevel;
  source: 'console' | 'navigation' | 'network';
  message: string;
  url?: string;
  line?: number;
  column?: number;
  timestamp: number;
};

export const BROWSER_DEFAULT_URL = 'about:blank';

export const BROWSER_ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
] as const;

export const BROWSER_DEFAULT_ZOOM_FACTOR = 1;

const ZOOM_EPSILON = 0.001;

export function normalizeBrowserZoomFactor(factor: number | undefined): number {
  if (factor === undefined || !Number.isFinite(factor)) return BROWSER_DEFAULT_ZOOM_FACTOR;
  const min = BROWSER_ZOOM_FACTORS[0];
  const max = BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];
  return Math.min(max, Math.max(min, factor));
}

export function nextBrowserZoomFactor(factor: number): number {
  const current = normalizeBrowserZoomFactor(factor);
  for (const step of BROWSER_ZOOM_FACTORS) {
    if (step > current + ZOOM_EPSILON) return step;
  }
  return BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];
}

export function previousBrowserZoomFactor(factor: number): number {
  const current = normalizeBrowserZoomFactor(factor);
  for (let i = BROWSER_ZOOM_FACTORS.length - 1; i >= 0; i--) {
    if (BROWSER_ZOOM_FACTORS[i] < current - ZOOM_EPSILON) return BROWSER_ZOOM_FACTORS[i];
  }
  return BROWSER_ZOOM_FACTORS[0];
}

export function canZoomIn(factor: number): boolean {
  return (
    normalizeBrowserZoomFactor(factor) <
    BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1] - ZOOM_EPSILON
  );
}

export function canZoomOut(factor: number): boolean {
  return normalizeBrowserZoomFactor(factor) > BROWSER_ZOOM_FACTORS[0] + ZOOM_EPSILON;
}

export function isDefaultBrowserZoomFactor(factor: number): boolean {
  return Math.abs(normalizeBrowserZoomFactor(factor) - BROWSER_DEFAULT_ZOOM_FACTOR) < ZOOM_EPSILON;
}

export function formatBrowserZoomPercent(factor: number): string {
  return `${Math.round(normalizeBrowserZoomFactor(factor) * 100)}%`;
}

export function normalizeBrowserUrl(
  rawInput: string,
  options: { allowFileUrls?: boolean } = {}
): BrowserUrlNormalizeResult {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (trimmed === 'about:blank') {
    return { ok: true, url: BROWSER_DEFAULT_URL, protocol: 'about:' };
  }

  const candidate = withDefaultScheme(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return { ok: true, url: parsed.toString(), protocol: parsed.protocol };
  }

  if (parsed.protocol === 'file:') {
    if (!options.allowFileUrls) {
      return { ok: false, reason: 'unsupported-file-url' };
    }
    return { ok: true, url: parsed.toString(), protocol: 'file:' };
  }

  return { ok: false, reason: 'unsupported-protocol' };
}

export function makeBrowserSessionIdentity(input: {
  projectId: string;
  workspaceId: string;
  taskId: string;
  browserId?: string;
}): BrowserSessionIdentity {
  return {
    browserId: input.browserId ?? crypto.randomUUID(),
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
  };
}

export function deriveBrowserPartition(identity: BrowserSessionIdentity): string {
  return [
    BROWSER_PARTITION_PREFIX,
    sanitizePartitionPart(identity.projectId),
    sanitizePartitionPart(identity.workspaceId),
    sanitizePartitionPart(identity.taskId),
    sanitizePartitionPart(identity.browserId),
  ].join('-');
}

export function createBrowserSessionSnapshot(input: {
  identity: BrowserSessionIdentity;
  currentUrl?: string;
  now?: number;
}): BrowserSessionSnapshot {
  const now = input.now ?? Date.now();
  const normalized = normalizeBrowserUrl(input.currentUrl ?? BROWSER_DEFAULT_URL);
  return {
    ...input.identity,
    partition: deriveBrowserPartition(input.identity),
    currentUrl: normalized.ok ? normalized.url : BROWSER_DEFAULT_URL,
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: BROWSER_DEFAULT_ZOOM_FACTOR,
    createdAt: now,
    updatedAt: now,
  };
}

function withDefaultScheme(input: string): string {
  if (isLocalhostLike(input)) {
    return `http://${input}`;
  }
  if (hasExplicitScheme(input)) {
    return input;
  }
  return `https://${input}`;
}

function hasExplicitScheme(input: string): boolean {
  const colonIndex = input.indexOf(':');
  if (colonIndex <= 0) return false;
  const prefix = input.slice(0, colonIndex);
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*$/.test(prefix)) return false;
  if (prefix.includes('.')) return false;
  return true;
}

function isLocalhostLike(input: string): boolean {
  const hostLike = input.split(/[/?#]/, 1)[0].toLowerCase();
  return (
    hostLike === 'localhost' ||
    hostLike.startsWith('localhost:') ||
    hostLike === '127.0.0.1' ||
    hostLike.startsWith('127.0.0.1:') ||
    hostLike === '[::1]' ||
    hostLike.startsWith('[::1]:') ||
    hostLike.endsWith('.localhost') ||
    hostLike.includes('.localhost:')
  );
}

function sanitizePartitionPart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : 'unknown';
}
