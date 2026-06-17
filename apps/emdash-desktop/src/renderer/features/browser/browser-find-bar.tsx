import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { ToolbarIconButton } from './browser-toolbar-button';
import type { BrowserWebviewAdapter } from './browser-webview-types';

export function BrowserFindBar({
  adapter,
  onRegisterOpenFind,
}: {
  adapter: BrowserWebviewAdapter | null;
  onRegisterOpenFind?: (openFind: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [requestCount, setRequestCount] = useState(0);
  const [matchStatus, setMatchStatus] = useState({ active: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRequestIdRef = useRef<number | null>(null);

  const openFind = useCallback(() => {
    setOpen(true);
    setRequestCount((count) => count + 1);
  }, []);

  useEffect(() => {
    onRegisterOpenFind?.(openFind);
    return () => onRegisterOpenFind?.(() => {});
  }, [onRegisterOpenFind, openFind]);

  useEffect(() => {
    if (!open) {
      adapter?.stopFindInPage('clearSelection');
      setMatchStatus({ active: 0, total: 0 });
      activeRequestIdRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [adapter, open, requestCount]);

  useEffect(() => {
    if (!open) return;
    const query = text.trim();
    if (!query) {
      adapter?.stopFindInPage('clearSelection');
      setMatchStatus({ active: 0, total: 0 });
      activeRequestIdRef.current = null;
      return;
    }
    activeRequestIdRef.current = adapter?.findInPage(query) ?? null;
  }, [adapter, open, text]);

  useEffect(() => {
    if (!adapter) return;
    return adapter.onFoundInPage((result) => {
      if (result.requestId !== activeRequestIdRef.current) return;
      setMatchStatus({
        active: result.matches > 0 ? result.activeMatchOrdinal : 0,
        total: result.matches,
      });
    });
  }, [adapter]);

  const findNext = (forward: boolean) => {
    const query = text.trim();
    if (!query) return;
    activeRequestIdRef.current = adapter?.findInPage(query, { findNext: true, forward }) ?? null;
  };

  const closeFind = () => {
    setOpen(false);
    setText('');
    setMatchStatus({ active: 0, total: 0 });
    activeRequestIdRef.current = null;
    window.setTimeout(() => adapter?.focus(), 0);
  };

  if (!open) return null;

  return (
    <form
      className="absolute top-11 right-2 z-50 flex min-w-80 animate-in items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 shadow-lg duration-150 fade-in-0 zoom-in-95 slide-in-from-top-1"
      onSubmit={(event) => {
        event.preventDefault();
        findNext(true);
      }}
    >
      <Search className="size-4 shrink-0 text-foreground-muted" />
      <Input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeFind();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            findNext(!event.shiftKey);
          }
        }}
        className="h-7 min-w-0 flex-1 border-0 px-1 text-sm shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
        aria-label="Find in browser page"
        placeholder="Find"
        spellCheck={false}
      />
      <div className="min-w-12 shrink-0 text-right text-xs text-foreground-muted tabular-nums">
        {text.trim() ? `${matchStatus.active}/${matchStatus.total}` : '0/0'}
      </div>
      <ToolbarIconButton
        label="Previous match"
        disabled={!text.trim()}
        onClick={() => findNext(false)}
      >
        <ChevronUp className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton label="Next match" disabled={!text.trim()} onClick={() => findNext(true)}>
        <ChevronDown className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton label="Close find" onClick={closeFind}>
        <X className="size-4" />
      </ToolbarIconButton>
    </form>
  );
}
