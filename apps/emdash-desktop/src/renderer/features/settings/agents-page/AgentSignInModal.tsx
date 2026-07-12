import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { Loader2 } from 'lucide-react';
import { reaction } from 'mobx';
import { useEffect, useRef, useState } from 'react';
import { AcpAuthLoginBinding } from '@renderer/lib/acp/auth-login-binding';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { isPrimaryMouseButton } from '@renderer/lib/pty/file-link-provider';
import {
  buildTheme,
  TERMINAL_LETTER_SPACING,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_PADDING_PX,
} from '@renderer/lib/pty/pty';
import { computeGridDimensions, measureTerminalCell } from '@renderer/lib/pty/pty-dimensions';
import { buildTerminalFontFamily } from '@renderer/lib/pty/terminal-font';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@shared/core/terminals/terminal-settings';

export type AgentSignInModalArgs = {
  providerId: string;
  methodId: string;
  providerName: string;
};

type AgentSignInModalProps = BaseModalProps<void> & AgentSignInModalArgs;

export function AgentSignInModal({
  providerId,
  methodId,
  providerName,
  onSuccess,
  onClose,
}: AgentSignInModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<AcpAuthLoginBinding | null>(null);
  const handledUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    let disposed = false;
    let animationFrame: number | null = null;
    const terminal = createLoginTerminal();
    terminal.open(host);
    styleLoginTerminal(terminal);
    terminal.focus();

    const inputDisposable = terminal.onData((data) => {
      bindingRef.current?.sendInput(data);
    });
    const resize = () => {
      if (disposed) return;
      resizeLoginTerminal(terminal, host, bindingRef.current);
    };
    const observer = new ResizeObserver(() => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(resize);
    });
    observer.observe(host);
    resize();

    void AcpAuthLoginBinding.create({ providerId, methodId, terminal }).then(
      (binding) => {
        if (disposed) {
          void binding.dispose();
          return;
        }
        bindingRef.current = binding;
        setReady(true);
        resize();
      },
      (err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      }
    );

    return () => {
      disposed = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      observer.disconnect();
      inputDisposable.dispose();
      void bindingRef.current?.dispose();
      bindingRef.current = null;
      terminal.dispose();
    };
  }, [methodId, providerId]);

  useEffect(() => {
    const binding = bindingRef.current;
    if (!binding || !ready) return;
    return reaction(
      () => binding.status.current(),
      (state) => {
        if (state.status.kind === 'authenticated') {
          void binding.dispose(false);
          bindingRef.current = null;
          onSuccess();
          return;
        }

        const pendingUrl = state.login?.pendingUrl;
        if (!pendingUrl || handledUrlsRef.current.has(pendingUrl.id)) return;
        handledUrlsRef.current.add(pendingUrl.id);
        confirmOpenExternalLink(pendingUrl.url);
        binding.markUrlHandled(pendingUrl.id);
      },
      { fireImmediately: true }
    );
  }, [onSuccess, ready]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in to {providerName}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="h-[520px] p-0">
        <div className="relative h-full">
          <div
            ref={terminalHostRef}
            className="h-full rounded-md border border-border bg-(--xterm-bg)"
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm text-foreground-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting sign-in terminal...
            </div>
          )}
          {error && (
            <div className="text-destructive absolute inset-0 bg-background p-4 text-sm">
              {error}
            </div>
          )}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function createLoginTerminal(): Terminal {
  const terminal = new Terminal({
    cols: 120,
    rows: 32,
    scrollback: 100_000,
    fontFamily: buildTerminalFontFamily(),
    fontSize: TERMINAL_FONT_SIZE_DEFAULT,
    lineHeight: TERMINAL_LINE_HEIGHT,
    letterSpacing: TERMINAL_LETTER_SPACING,
    allowProposedApi: true,
    scrollOnUserInput: false,
    linkHandler: {
      activate: (event, text) => {
        if (!isPrimaryMouseButton(event)) return;
        confirmOpenExternalLink(text);
      },
    },
    theme: buildTheme(),
  });
  terminal.loadAddon(
    new WebLinksAddon((event, uri) => {
      if (!isPrimaryMouseButton(event)) return;
      event.preventDefault();
      confirmOpenExternalLink(uri);
    })
  );
  return terminal;
}

function styleLoginTerminal(terminal: Terminal): void {
  const element = (terminal as unknown as { element?: HTMLElement }).element;
  if (!element) return;
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.boxSizing = 'border-box';
  element.style.padding = `${TERMINAL_PADDING_PX}px`;
  element.style.backgroundColor = 'var(--xterm-bg)';
}

function resizeLoginTerminal(
  terminal: Terminal,
  host: HTMLElement,
  binding: AcpAuthLoginBinding | null
): void {
  const cell = measureTerminalCell(
    buildTerminalFontFamily(),
    TERMINAL_FONT_SIZE_DEFAULT,
    TERMINAL_LINE_HEIGHT,
    TERMINAL_LETTER_SPACING
  );
  if (!cell) return;
  const dims = computeGridDimensions({
    widthPx: host.clientWidth,
    heightPx: host.clientHeight,
    cellWidth: cell.width,
    cellHeight: cell.height,
    paddingPx: TERMINAL_PADDING_PX,
  });
  if (!dims) return;
  if (terminal.cols !== dims.cols || terminal.rows !== dims.rows) {
    terminal.resize(dims.cols, dims.rows);
  }
  binding?.resize(dims.cols, dims.rows);
}
