export const BROWSER_PARTITION_PREFIX = 'persist:emdash-browser';

export const DEFAULT_BROWSER_PROFILE_ID = 'default';
export const BROWSER_ISOLATED_PROFILE_ID = 'isolated-per-task';

export type BrowserProfile = {
  id: string;
  name: string;
};

export const DEFAULT_BROWSER_PROFILES: BrowserProfile[] = [
  { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
];

export type BrowserProfileSelection = string;

export const BROWSER_PROFILE_PARTITION = browserProfilePartition(DEFAULT_BROWSER_PROFILE_ID);

export type BrowserNavigationProtocol = 'about:' | 'file:' | 'http:' | 'https:';

export type BrowserUrlNormalizeResult =
  | { ok: true; url: string; protocol: BrowserNavigationProtocol }
  | { ok: false; reason: BrowserUrlRejectionReason };

export type BrowserUrlRejectionReason =
  | 'empty'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'unsupported-file-url';

export type BrowserUrlNormalizeOptions = {
  allowFileUrls?: boolean;
  allowSearchQueries?: boolean;
};

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
  profileId: BrowserProfileSelection;
  partition: string;
  currentUrl: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
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
export const BROWSER_DEFAULT_SEARCH_URL = 'https://www.google.com/search';

const BROWSER_RESERVED_SCHEMES = new Set(['about', 'data', 'file', 'http', 'https', 'javascript']);

export function normalizeBrowserUrl(
  rawInput: string,
  options: BrowserUrlNormalizeOptions = {}
): BrowserUrlNormalizeResult {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (trimmed === 'about:blank') {
    return { ok: true, url: BROWSER_DEFAULT_URL, protocol: 'about:' };
  }

  if (options.allowSearchQueries !== false && isSearchQuery(trimmed)) {
    return { ok: true, url: browserSearchUrl(trimmed), protocol: 'https:' };
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

export function browserProfilePartition(profileId: string): string {
  return `${BROWSER_PARTITION_PREFIX}-profile-${profileId}`;
}

export function makeIsolatedBrowserPartition(identity: BrowserSessionIdentity): string {
  return [
    BROWSER_PARTITION_PREFIX,
    'isolated',
    partitionComponent(identity.projectId),
    partitionComponent(identity.workspaceId),
    partitionComponent(identity.taskId),
  ].join('-');
}

export function browserPartitionForProfile(
  identity: BrowserSessionIdentity,
  profileId: BrowserProfileSelection
): string {
  if (profileId === BROWSER_ISOLATED_PROFILE_ID) return makeIsolatedBrowserPartition(identity);
  return browserProfilePartition(profileId);
}

export function isBrowserProfileId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function isNamedBrowserProfileId(value: string): boolean {
  return value !== BROWSER_ISOLATED_PROFILE_ID && isBrowserProfileId(value);
}

export function normalizeBrowserProfileSelection(
  profileId: string | undefined
): BrowserProfileSelection {
  if (
    profileId === BROWSER_ISOLATED_PROFILE_ID ||
    (profileId && isNamedBrowserProfileId(profileId))
  ) {
    return profileId;
  }
  return DEFAULT_BROWSER_PROFILE_ID;
}

export function browserProfileLabel(
  profileId: string,
  profiles: readonly BrowserProfile[]
): string {
  if (profileId === BROWSER_ISOLATED_PROFILE_ID) return 'Isolated per task';
  return profiles.find((profile) => profile.id === profileId)?.name ?? profileId;
}

export function createBrowserSessionSnapshot(input: {
  identity: BrowserSessionIdentity;
  profileId?: BrowserProfileSelection;
  currentUrl?: string;
  now?: number;
}): BrowserSessionSnapshot {
  const now = input.now ?? Date.now();
  const profileId = normalizeBrowserProfileSelection(input.profileId);
  const normalized = normalizeBrowserUrl(input.currentUrl ?? BROWSER_DEFAULT_URL, {
    allowSearchQueries: false,
  });
  return {
    ...input.identity,
    profileId,
    partition: browserPartitionForProfile(input.identity, profileId),
    currentUrl: normalized.ok ? normalized.url : BROWSER_DEFAULT_URL,
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    createdAt: now,
    updatedAt: now,
  };
}

function partitionComponent(value: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'unknown';
}

function browserSearchUrl(query: string): string {
  const url = new URL(BROWSER_DEFAULT_SEARCH_URL);
  url.searchParams.set('q', query);
  return url.toString();
}

function isSearchQuery(input: string): boolean {
  if (isLocalhostLike(input)) return false;

  const scheme = explicitSchemePrefix(input);
  if (scheme) {
    return /\s/.test(input) && !BROWSER_RESERVED_SCHEMES.has(scheme.toLowerCase());
  }

  return !looksLikeNavigableHost(input);
}

function looksLikeNavigableHost(input: string): boolean {
  const hostLike = input.split(/[/?#]/, 1)[0].toLowerCase();
  if (hostLike.length === 0 || /\s/.test(hostLike)) return false;
  if (hostLike.startsWith('[') && hostLike.includes(']')) return true;
  return hostLike.includes('.');
}

function withDefaultScheme(input: string): string {
  if (isLocalhostLike(input)) {
    return `http://${input}`;
  }
  if (explicitSchemePrefix(input)) {
    return input;
  }
  return `https://${input}`;
}

function explicitSchemePrefix(input: string): string | null {
  const colonIndex = input.indexOf(':');
  if (colonIndex <= 0) return null;
  const prefix = input.slice(0, colonIndex);
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*$/.test(prefix)) return null;
  if (prefix.includes('.')) return null;
  return prefix;
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
