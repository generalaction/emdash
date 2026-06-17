import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  Focus,
  Globe,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  BROWSER_DEFAULT_URL,
  BROWSER_DEFAULT_ZOOM_FACTOR,
  BROWSER_ISOLATED_PROFILE_ID,
  DEFAULT_BROWSER_PROFILES,
  browserProfileLabel,
  canZoomIn,
  canZoomOut,
  formatBrowserZoomPercent,
  isDefaultBrowserZoomFactor,
  nextBrowserZoomFactor,
  normalizeBrowserUrl,
  previousBrowserZoomFactor,
  type BrowserSessionSnapshot,
} from '@shared/browser';
import { BrowserFindBar } from './browser-find-bar';
import { browserSessionStore } from './browser-session-store';
import {
  canOpenBrowserUrlExternally,
  captureBrowserScreenshot,
  clearBrowserData,
  confirmClearBrowserStorage,
  openBrowserUrlExternally,
} from './browser-toolbar-actions';
import { ToolbarIconButton } from './browser-toolbar-button';
import { browserUrlInputText } from './browser-url-input';
import type { BrowserWebviewAdapter } from './browser-webview-types';

// Selection is conveyed by the checkmark alone (matching SelectItem); the base
// radio item pins a background on the checked row and mutes unchecked rows.
const PROFILE_RADIO_ITEM_CLASS = 'text-foreground data-checked:bg-transparent';

export function BrowserToolbar({
  session,
  adapter,
  autoFocusUrl,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onForceReload,
  onSetZoomFactor,
  onFocusUrl,
  onRegisterOpenFind,
}: {
  session: BrowserSessionSnapshot;
  adapter: BrowserWebviewAdapter | null;
  autoFocusUrl?: boolean;
  onNavigate?: (url: string) => boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onReload?: () => void;
  onForceReload?: () => void;
  onSetZoomFactor?: (factor: number) => void;
  onFocusUrl?: (focus: () => void) => void;
  onRegisterOpenFind?: (openFind: () => void) => void;
}) {
  const [urlText, setUrlText] = useState(browserUrlInputText(session.currentUrl));
  const [urlError, setUrlError] = useState<string | null>(null);
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null);
  const [screenshotSpin, triggerScreenshotSpin] = useTransientFlag(300);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const { value: browserSettings } = useAppSettingsKey('browser');
  const { navigate: navigateToView } = useNavigate();
  const profiles = browserSettings?.profiles ?? DEFAULT_BROWSER_PROFILES;
  const profileLabel = browserProfileLabel(session.profileId, profiles);
  const faviconUrl =
    session.faviconUrl && session.faviconUrl !== failedFaviconUrl ? session.faviconUrl : null;

  useEffect(() => {
    setUrlText(browserUrlInputText(session.currentUrl));
  }, [session.currentUrl]);

  useEffect(() => {
    setFailedFaviconUrl(null);
  }, [session.faviconUrl]);

  useEffect(() => {
    onFocusUrl?.(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  }, [onFocusUrl]);

  useEffect(() => {
    if (!autoFocusUrl) return;
    const timer = window.setTimeout(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoFocusUrl]);

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
    onNavigate?.(normalized.url);
  };

  const openExternal = () => {
    openBrowserUrlExternally(session.currentUrl);
  };

  const openDevTools = () => {
    void rpc.browser.openDevTools(session.browserId);
  };

  const confirmClearStorage = () => {
    confirmClearBrowserStorage(session, adapter, profileLabel);
  };

  const switchProfile = (profileId: string) => {
    if (profileId === session.profileId) return;
    browserSessionStore.setSessionProfile(session.browserId, profileId, profiles);
  };

  const takeScreenshot = () => {
    triggerScreenshotSpin();
    void captureBrowserScreenshot(session);
  };

  const canOpenExternal = canOpenBrowserUrlExternally(session.currentUrl);
  const zoomFactor = session.zoomFactor;

  return (
    <div className="relative z-10 flex h-10 shrink-0 items-center gap-1 overflow-visible border-b border-border bg-background-secondary-1 px-2">
      <ToolbarIconButton
        label="Back"
        disabled={!adapter || !session.canGoBack}
        onClick={() => onGoBack?.()}
      >
        <ArrowLeft className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Forward"
        disabled={!adapter || !session.canGoForward}
        onClick={() => onGoForward?.()}
      >
        <ArrowRight className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton label={session.isLoading ? 'Stop' : 'Reload'} onClick={() => onReload?.()}>
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
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 rounded-sm"
              draggable={false}
              onError={() => setFailedFaviconUrl(faviconUrl)}
            />
          ) : (
            <Globe className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-foreground-muted" />
          )}
          <Input
            ref={urlInputRef}
            value={urlText}
            onChange={(event) => {
              setUrlText(event.target.value);
              if (urlError) setUrlError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            className="h-7 truncate border-0 pr-8 pl-7 text-sm shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
            aria-label="Browser URL"
            placeholder="Search or enter URL"
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
      <BrowserFindBar adapter={adapter} onRegisterOpenFind={onRegisterOpenFind} />
      <ToolbarIconButton
        label="Copy screenshot"
        disabled={session.currentUrl === BROWSER_DEFAULT_URL || session.isLoading}
        onClick={takeScreenshot}
      >
        <Focus
          className={cn(
            'size-4 transition-transform duration-300 ease-out',
            screenshotSpin && 'rotate-90'
          )}
        />
      </ToolbarIconButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Browser actions"
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem disabled={!canOpenExternal} onClick={openExternal}>
            Open externally
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!adapter} onClick={() => onForceReload?.()}>
            Force reload
          </DropdownMenuItem>
          {import.meta.env.DEV && (
            <DropdownMenuItem onClick={openDevTools}>Open DevTools</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Browser profile</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-44">
              <DropdownMenuRadioGroup
                value={session.profileId}
                onValueChange={(value) => switchProfile(String(value))}
              >
                {profiles.map((profile) => (
                  <DropdownMenuRadioItem
                    key={profile.id}
                    value={profile.id}
                    className={PROFILE_RADIO_ITEM_CLASS}
                  >
                    {profile.name}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem
                  value={BROWSER_ISOLATED_PROFILE_ID}
                  className={PROFILE_RADIO_ITEM_CLASS}
                >
                  Isolated per task
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigateToView('settings', { tab: 'browser' })}>
                Manage profiles…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span>Zoom</span>
            <div className="flex items-center gap-1">
              <div className="flex items-center rounded-md bg-background-quaternary-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="Zoom out"
                  disabled={!canZoomOut(zoomFactor)}
                  onClick={() => onSetZoomFactor?.(previousBrowserZoomFactor(zoomFactor))}
                >
                  <Minus className="size-3.5" />
                </Button>
                <span className="min-w-11 text-center text-xs text-foreground-muted tabular-nums">
                  {formatBrowserZoomPercent(zoomFactor)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="Zoom in"
                  disabled={!canZoomIn(zoomFactor)}
                  onClick={() => onSetZoomFactor?.(nextBrowserZoomFactor(zoomFactor))}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Reset zoom"
                disabled={isDefaultBrowserZoomFactor(zoomFactor)}
                onClick={() => onSetZoomFactor?.(BROWSER_DEFAULT_ZOOM_FACTOR)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!adapter}
            onClick={() => clearBrowserData(session, 'cookies', () => adapter?.reload())}
          >
            Clear cookies
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!adapter}
            onClick={() => clearBrowserData(session, 'cache', () => adapter?.reloadIgnoringCache())}
          >
            Clear cache
          </DropdownMenuItem>
          <DropdownMenuItem onClick={confirmClearStorage}>Clear browser storage</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

/** Returns a flag that turns on when triggered and resets itself after `durationMs`. */
function useTransientFlag(durationMs: number): [boolean, () => void] {
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  const trigger = useCallback(() => {
    setActive(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setActive(false), durationMs);
  }, [durationMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return [active, trigger];
}

function urlRejectionMessage(reason: string): string {
  if (reason === 'empty') return 'Enter a URL';
  if (reason === 'unsupported-file-url') return 'File URLs are not enabled for this browser';
  if (reason === 'unsupported-protocol') return 'This URL scheme is not supported';
  return 'Enter a valid URL';
}
