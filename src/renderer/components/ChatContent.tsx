import React from 'react';
import { getInstallCommandForProvider } from '@shared/agent-provider-registry';
import { makePtySessionId } from '@shared/ptySessionId';
import { useConversations } from '../_deprecated/ConversationsProvider';
import { useChatView } from '../contexts/ChatViewProvider';
import { useDependencies } from '../contexts/DependenciesProvider';
import { rpc } from '../core/ipc';
import { TerminalPane } from '../core/terminals/terminal-pane';
import { cssVar } from '../lib/cssVars';
import type { UiAgent } from '../providers/meta';
import InstallBanner from './InstallBanner';

export function ChatContent() {
  const { isLoaded: conversationsLoaded } = useConversations();
  const {
    task,
    project,
    agent,
    effectiveTheme,
    terminalId,
    conversationId,
    projectRemoteConnectionId,
    cliStartError,
    shouldCaptureFirstMessage,
    terminalRef,
    handleFirstMessage,
  } = useChatView();

  // Deterministic session ID: renderer subscribes before the main process starts the session.
  const sessionId = project?.id
    ? makePtySessionId(project.id, task.id, conversationId)
    : terminalId; // fallback for tasks without a project (should not happen in practice)

  const { getStatus, install } = useDependencies();
  const agentStatus = getStatus(agent);
  const isAgentInstalled = agentStatus ? agentStatus.status === 'available' : null;

  const agentBgClass = agent === 'mistral' ? 'bg-[var(--xterm-bg-mistral)]' : '';

  const themeOverride =
    agent === 'mistral' ? { background: cssVar('--xterm-bg-mistral') } : undefined;

  const contentFilter =
    agent === 'charm' && effectiveTheme !== 'dark' && effectiveTheme !== 'dark-black'
      ? 'invert(1) hue-rotate(180deg) brightness(1.1) contrast(1.05)'
      : undefined;

  return (
    <div className="space-y-2">
      {isAgentInstalled === false && (
        <InstallBanner
          agent={agent as UiAgent}
          terminalId={terminalId}
          installCommand={getInstallCommandForProvider(agent as UiAgent)}
          onRunInstall={(_cmd) => {
            install(agent).catch(() => {
              try {
                window.electronAPI.ptyInput({ id: terminalId, data: `${_cmd}\n` });
              } catch {}
            });
          }}
          onOpenExternal={(url) => rpc.app.openExternal(url)}
          mode="missing"
        />
      )}
      {cliStartError && (
        <InstallBanner
          agent={agent}
          terminalId={terminalId}
          installCommand={null}
          onOpenExternal={(url) => rpc.app.openExternal(url)}
          mode="start_failed"
          details={cliStartError}
        />
      )}

      <div className={`mx-auto h-full max-w-4xl overflow-hidden rounded-md ${agentBgClass}`}>
        {conversationsLoaded && (
          <TerminalPane
            ref={terminalRef}
            sessionId={sessionId}
            remoteConnectionId={projectRemoteConnectionId ?? undefined}
            mapShiftEnterToCtrlJ
            onActivity={() => {
              try {
                window.localStorage.setItem(`agent:locked:${task.id}`, agent);
              } catch {}
            }}
            variant={
              effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? 'dark' : 'light'
            }
            themeOverride={themeOverride}
            contentFilter={contentFilter}
            onFirstMessage={shouldCaptureFirstMessage ? handleFirstMessage : undefined}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  );
}
