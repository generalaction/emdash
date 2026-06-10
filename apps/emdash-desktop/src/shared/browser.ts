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
  zoomFactor?: number;
  loadError?: BrowserLoadError;
  createdAt: number;
  updatedAt: number;
};

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
