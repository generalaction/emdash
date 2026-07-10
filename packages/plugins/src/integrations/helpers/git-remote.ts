export type ParsedGitRemote = {
  host: string;
  slug: string;
};

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value;
}

function normalizeSlug(slug: string): string | null {
  const value = stripGitSuffix(slug.trim()).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!value || value.includes('\\')) return null;
  const parts = value.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.join('/');
}

function toRemote(host: string, slug: string): ParsedGitRemote | null {
  const normalizedHost = host.trim().toLowerCase();
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedHost || !normalizedSlug) return null;
  return { host: normalizedHost, slug: normalizedSlug };
}

export function parseGitRemoteUrl(remoteUrl: string): ParsedGitRemote | null {
  const value = remoteUrl.trim();
  if (!value) return null;

  if (!value.includes('://')) {
    const scpMatch = /^[^@\s]+@([^:\s]+):(.+)$/.exec(value);
    if (scpMatch) return toRemote(scpMatch[1], scpMatch[2]);
  }

  if (value.startsWith('ssh://')) {
    const sshMatch = /^ssh:\/\/(?:[^@\s/]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/i.exec(value);
    if (sshMatch) return toRemote(sshMatch[1], sshMatch[2]);
    try {
      const parsed = new URL(value);
      if (!parsed.hostname) return null;
      return toRemote(parsed.hostname, parsed.pathname);
    } catch {
      return null;
    }
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value);
      if (!parsed.host) return null;
      return toRemote(parsed.host, parsed.pathname);
    } catch {
      return null;
    }
  }

  return null;
}
