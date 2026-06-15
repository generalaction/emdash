import { Globe, Server } from 'lucide-react';
import { useEffect } from 'react';
import { EmdashLogo } from '@renderer/lib/emdash-logo';

export function BrowserStartPage({
  devServerUrls,
  onFocusUrlBar,
  onOpenUrl,
}: {
  devServerUrls: string[];
  onFocusUrlBar: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const localUrls = devServerUrls.filter(isLocalUrl);

  useEffect(() => {
    onFocusUrlBar();
  }, [onFocusUrlBar]);

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-10 bg-background p-6">
      <EmdashLogo height={32} className="text-foreground" />

      {localUrls.length > 0 && (
        <div className="flex w-full max-w-xl flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground-muted">Local servers</h2>
            <Server className="size-4 text-foreground-tertiary-muted" />
          </div>
          <div className="flex flex-col gap-2">
            {localUrls.map((url) => (
              <button
                key={url}
                type="button"
                className="group focus-visible:ring-ring/50 flex min-h-16 w-full items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-border hover:bg-background-secondary focus-visible:ring-3 focus-visible:outline-none"
                onClick={() => onOpenUrl(url)}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background-secondary text-foreground-info">
                  <Globe className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {formatServerTitle(url)}
                  </span>
                  <span className="block truncate text-xs text-foreground-muted">
                    {formatServerAddress(url)}
                  </span>
                </span>
                <span className="size-2 shrink-0 rounded-full bg-foreground-info" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function formatServerAddress(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return url;
  }
}

function formatServerTitle(url: string): string {
  const address = formatServerAddress(url);
  if (address.startsWith('localhost:')) return `Port ${address.slice('localhost:'.length)}`;
  if (address.startsWith('127.0.0.1:')) return `Port ${address.slice('127.0.0.1:'.length)}`;
  return address;
}

function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}
