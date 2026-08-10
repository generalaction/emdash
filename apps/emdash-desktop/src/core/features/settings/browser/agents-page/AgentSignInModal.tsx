import { sshConnectionIdOf, type HostRef } from '@emdash/core/primitives/host/api';
import { Button, Dialog } from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { Loader2 } from 'lucide-react';
import { reaction } from 'mobx';
import { useEffect, useRef, useState } from 'react';
import { AcpAuthLoginBinding } from '@core/features/agents/api/browser/auth-login-binding';
import { getMachinesClient } from '@core/features/machines/api/browser/client';
import { isPrimaryMouseButton } from '@core/features/terminals/api/browser/pty/file-link-provider';
import {
  buildTheme,
  TERMINAL_LETTER_SPACING,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_PADDING_PX,
} from '@core/features/terminals/api/browser/pty/pty';
import {
  computeGridDimensions,
  measureTerminalCell,
} from '@core/features/terminals/api/browser/pty/pty-dimensions';
import { buildTerminalFontFamily } from '@core/features/terminals/api/browser/pty/terminal-font';
import { confirmOpenExternalLink } from '@core/features/workbench/api/browser/open-external-link';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@core/primitives/terminals/api';

export type AgentSignInModalArgs = {
  providerId: string;
  methodId: string;
  providerName: string;
  /** Host the sign-in runs on; remote hosts show the machine's name in the title. */
  host: HostRef;
};

/** Resolves the display name of the machine behind a remote host ref (null for local). */
function useMachineName(host: HostRef): string | null {
  const connectionId = sshConnectionIdOf(host);
  const { data } = useQuery({
    queryKey: ['machines', 'name', connectionId],
    queryFn: async () => (await getMachinesClient()).getMachines(undefined),
    enabled: connectionId !== undefined,
    staleTime: 60 * 1000,
  });
  if (!connectionId) return null;
  return data?.find((connection) => connection.id === connectionId)?.name ?? null;
}

export function AgentSignInModal({
  providerId,
  methodId,
  providerName,
  host,
}: AgentSignInModalArgs) {
  const modal = useModalController('agentSignInModal');
  const machineName = useMachineName(host);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<AcpAuthLoginBinding | null>(null);
  const handledUrlsRef = useRef(new Set<string>());
  const completeRef = useRef(modal.complete);
  completeRef.current = modal.complete;

  useEffect(() => {
    const terminalHost = terminalHostRef.current;
    if (!terminalHost) return;

    let disposed = false;
    let animationFrame: number | null = null;
    const terminal = createLoginTerminal();
    terminal.open(terminalHost);
    styleLoginTerminal(terminal);
    terminal.focus();

    const inputDisposable = terminal.onData((data) => {
      bindingRef.current?.sendInput(data);
    });
    const resize = () => {
      if (disposed) return;
      resizeLoginTerminal(terminal, terminalHost, bindingRef.current);
    };
    const observer = new ResizeObserver(() => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(resize);
    });
    observer.observe(terminalHost);
    resize();

    void AcpAuthLoginBinding.create({
      host,
      providerId,
      methodId,
      terminal,
    }).then(
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
  }, [host, methodId, providerId]);

  useEffect(() => {
    const binding = bindingRef.current;
    if (!binding || !ready) return;
    return reaction(
      () => binding.status.current(),
      (state) => {
        if (state.status.kind === 'authenticated') {
          void binding.dispose(false);
          bindingRef.current = null;
          completeRef.current();
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
  }, [ready]);

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Sign in to {providerName}</Dialog.Title>
        {machineName && <Dialog.Description>on {machineName}</Dialog.Description>}
      </Dialog.Header>
      <Dialog.Body className="h-[520px] p-0">
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
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={modal.dismiss}>
          Close
        </Button>
      </Dialog.Footer>
    </>
  );
}

export const agentSignInModal = defineModal<void>()({
  id: 'agentSignInModal',
  component: AgentSignInModal,
  size: 'lg',
});

function createLoginTerminal(): Terminal {
  const terminal = new Terminal({
    cols: 120,
    rows: 32,
    // Short-lived login flow: a screenful of context is plenty.
    scrollback: 1_000,
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
