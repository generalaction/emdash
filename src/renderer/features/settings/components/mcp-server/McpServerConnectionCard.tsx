import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { useMcpServerStatus } from './use-mcp-server-status';

type SnippetKey = 'claudeCode' | 'cursor' | 'codex';

const SNIPPET_LABELS: Record<SnippetKey, string> = {
  claudeCode: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
};

/**
 * Snippets are sourced from `rpc.mcpServer.getConfigSnippets()` so the
 * displayed port stays in sync with `appSettings.mcpServer.port` — refetched
 * whenever the live status changes.
 */
function useConfigSnippets(port: number | null) {
  return useQuery({
    // Include port in the key so the snippets update when the user changes it.
    queryKey: ['mcpServer', 'configSnippets', port] as const,
    queryFn: async () => {
      const result = await rpc.mcpServer.getConfigSnippets();
      return result.success ? result.data : null;
    },
    staleTime: 30_000,
  });
}

/**
 * Inline copy-to-clipboard helper used for both the token and the snippets.
 * Shows a transient "copied" state on the trigger button.
 */
function useCopyToClipboard(resetMs = 1600) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string) => {
      if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, resetMs);
      } catch {
        setCopied(false);
      }
    },
    [resetMs]
  );

  return { copied, copy };
}

function SnippetBlock({ label, snippet }: { label: string; snippet: string }) {
  const { copied, copy } = useCopyToClipboard();
  const CopyIcon = copied ? Check : Copy;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-muted">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void copy(snippet)}
          aria-label={`Copy ${label} config snippet`}
        >
          <CopyIcon className="h-3 w-3" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-relaxed text-foreground-muted">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}

export function McpServerConnectionCard() {
  const { status } = useMcpServerStatus();
  const { data: snippets } = useConfigSnippets(status?.port ?? null);
  const tokenPresent = status?.tokenPresent ?? false;
  const showConfirmRotate = useShowModal('confirmActionModal');
  const tokenCopy = useCopyToClipboard();

  // The main process never exposes the existing bearer token over RPC, so we
  // can only display it when the user explicitly rotates it (the rotate RPC
  // returns the new value). Until then, the field is masked.
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  const performRotate = useCallback(async () => {
    setIsRotating(true);
    try {
      const result = await rpc.mcpServer.rotateToken();
      if (result.success) {
        setRevealedToken(result.data.token);
        setRevealed(true);
        toast({
          title: 'Token rotated',
          description: 'External MCP clients must reconnect with the new token.',
        });
      } else {
        toast({
          title: 'Failed to rotate token',
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to rotate token',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsRotating(false);
    }
  }, []);

  const handleRotateClick = useCallback(() => {
    showConfirmRotate({
      title: 'Rotate MCP bearer token?',
      description:
        'This invalidates the current token. Any external MCP clients (Claude Code, Cursor, Codex) using the old token must reconnect with the new one.',
      confirmLabel: 'Rotate token',
      onSuccess: () => void performRotate(),
    });
  }, [performRotate, showConfirmRotate]);

  const displayValue = (() => {
    if (revealed && revealedToken) return revealedToken;
    if (!tokenPresent) return '';
    return '••••••••••••••••••••••••';
  })();

  const RevealIcon = revealed ? EyeOff : Eye;
  const CopyIcon = tokenCopy.copied ? Check : Copy;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="mcp-server-token" className="text-sm font-normal text-foreground">
          Bearer token
        </label>
        <div className="flex items-center gap-2">
          <input
            id="mcp-server-token"
            readOnly
            type="text"
            value={displayValue}
            placeholder={tokenPresent ? '' : 'No token yet — rotate to generate one.'}
            className="h-8 flex-1 truncate rounded-md border border-border bg-transparent px-2.5 py-1 font-mono text-xs text-foreground-muted outline-none disabled:opacity-50"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={!revealedToken}
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? 'Hide token' : 'Reveal token'}
            title={
              revealedToken
                ? revealed
                  ? 'Hide token'
                  : 'Reveal token'
                : 'Rotate to reveal the token'
            }
          >
            <RevealIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={!revealedToken}
            onClick={() => revealedToken && void tokenCopy.copy(revealedToken)}
            aria-label="Copy token"
            title={revealedToken ? 'Copy token' : 'Rotate to copy the token'}
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRotateClick}
            disabled={isRotating}
            aria-label="Rotate token"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRotating ? 'animate-spin' : ''}`} />
            Rotate
          </Button>
        </div>
        <p className="text-xs text-foreground-passive">
          {tokenPresent
            ? 'A token is stored in ~/.emdash/mcp.json. Reveal/copy is only available right after rotation; the existing value is never read back over IPC.'
            : 'No bearer token has been generated yet. The MCP server creates one automatically when it first starts.'}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-normal text-foreground">Client config snippets</span>
        {snippets ? (
          (Object.keys(SNIPPET_LABELS) as SnippetKey[]).map((key) => (
            <SnippetBlock key={key} label={SNIPPET_LABELS[key]} snippet={snippets[key]} />
          ))
        ) : (
          <p className="text-xs text-foreground-passive">Loading snippets…</p>
        )}
      </div>
    </div>
  );
}
