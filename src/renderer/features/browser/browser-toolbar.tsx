import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { normalizeBrowserUrl, type BrowserSessionSnapshot } from '@shared/browser';
import { confirmClearBrowserStorage, openBrowserUrlExternally } from './browser-toolbar-actions';
import type { BrowserWebviewAdapter } from './browser-webview-types';

export function BrowserToolbar({
  session,
  adapter,
  devServerUrls = [],
  onFocusUrl,
}: {
  session: BrowserSessionSnapshot;
  adapter: BrowserWebviewAdapter | null;
  devServerUrls?: string[];
  onFocusUrl?: (focus: () => void) => void;
}) {
  const [urlText, setUrlText] = useState(session.currentUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUrlText(session.currentUrl);
  }, [session.currentUrl]);

  useEffect(() => {
    onFocusUrl?.(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  }, [onFocusUrl]);

  const navigate = () => {
    navigateTo(urlText);
  };

  const navigateTo = (url: string) => {
    const normalized = normalizeBrowserUrl(url);
    if (!normalized.ok) {
      setUrlError(urlRejectionMessage(normalized.reason));
      return;
    }
    setUrlError(null);
    setUrlText(normalized.url);
    void adapter?.loadUrl(normalized.url);
  };

  const openExternal = () => {
    openBrowserUrlExternally(session.currentUrl);
  };

  const openDevTools = () => {
    void rpc.browser.openDevTools(session.browserId);
  };

  const confirmClearStorage = () => {
    confirmClearBrowserStorage(session, adapter);
  };

  const disabled = adapter === null;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background-secondary px-2">
      <ToolbarIconButton
        label="Back"
        disabled={disabled || !session.canGoBack}
        onClick={() => adapter?.goBack()}
      >
        <ArrowLeft className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Forward"
        disabled={disabled || !session.canGoForward}
        onClick={() => adapter?.goForward()}
      >
        <ArrowRight className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={session.isLoading ? 'Stop' : 'Reload'}
        disabled={disabled}
        onClick={() => (session.isLoading ? adapter?.stop() : adapter?.reload())}
      >
        {session.isLoading ? <Square className="size-3.5" /> : <RefreshCw className="size-4" />}
      </ToolbarIconButton>
      <form
        className="min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <div className="relative">
          <Globe className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-foreground-muted" />
          <Input
            ref={urlInputRef}
            value={urlText}
            onChange={(event) => {
              setUrlText(event.target.value);
              if (urlError) setUrlError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            className="h-7 truncate pr-8 pl-7 text-sm"
            aria-label="Browser URL"
            spellCheck={false}
            autoCapitalize="none"
          />
          {session.isLoading && (
            <Loader2 className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-foreground-muted" />
          )}
        </div>
        {urlError && (
          <div className="sr-only" role="alert">
            {urlError}
          </div>
        )}
      </form>
      <ToolbarIconButton label="Open externally" onClick={openExternal}>
        <ExternalLink className="size-4" />
      </ToolbarIconButton>
      {devServerUrls.slice(0, 3).map((url) => (
        <button
          key={url}
          type="button"
          className="max-w-32 shrink truncate rounded border border-border px-2 py-1 text-xs text-foreground-muted hover:bg-background-secondary-1"
          onClick={() => navigateTo(url)}
          title={url}
        >
          {devServerLabel(url)}
        </button>
      ))}
      {import.meta.env.DEV && (
        <ToolbarIconButton label="DevTools" onClick={openDevTools}>
          <Wrench className="size-4" />
        </ToolbarIconButton>
      )}
      <ToolbarIconButton label="Clear browser storage" onClick={confirmClearStorage}>
        <Trash2 className="size-4" />
      </ToolbarIconButton>
      {session.loadError && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="border-destructive/40 text-destructive flex h-7 max-w-[220px] items-center gap-1 truncate rounded border px-2 text-xs">
                <RotateCcw className="size-3 shrink-0" />
                <span className="truncate">{session.loadError.description}</span>
              </div>
            }
          />
          <TooltipContent>{session.loadError.description}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ToolbarIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function devServerLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}

function urlRejectionMessage(reason: string): string {
  if (reason === 'empty') return 'Enter a URL';
  if (reason === 'unsupported-file-url') return 'File URLs are not enabled for this browser';
  if (reason === 'unsupported-protocol') return 'This URL scheme is not supported';
  return 'Enter a valid URL';
}
