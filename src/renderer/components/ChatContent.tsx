import React from 'react';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import { makePtySessionId } from '@shared/ptySessionId';
import { useChatView } from '../contexts/ChatViewProvider';
import { useConversations } from '../contexts/ConversationsProvider';
import { useDependencies } from '../contexts/DependenciesProvider';
import { rpc } from '../lib/ipc';
import { agentMeta, type UiAgent } from '../providers/meta';
import InstallBanner from './InstallBanner';
import { TerminalPane } from './TerminalPane';

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
    autoApproveEnabled,
    initialInjection,
    shouldCaptureFirstMessage,
    terminalRef,
    handleFirstMessage,
    setCliStartError,
  } = useChatView();

  // Deterministic session ID: renderer subscribes before the main process starts the session.
  const sessionId = project?.id
    ? makePtySessionId(project.id, task.id, conversationId)
    : terminalId; // fallback for tasks without a project (should not happen in practice)

  const { getStatus, install } = useDependencies();
  const agentStatus = getStatus(agent);
  const isAgentInstalled = agentStatus ? agentStatus.status === 'available' : null;

  const agentBgClass = (() => {
    if (agent === 'charm') {
      if (effectiveTheme === 'dark-black') return 'bg-black';
      if (effectiveTheme === 'dark') return 'bg-card';
      return 'bg-white';
    }
    if (agent === 'mistral') {
      if (effectiveTheme === 'dark-black') return 'bg-[#141820]';
      if (effectiveTheme === 'dark') return 'bg-[#202938]';
      return 'bg-white';
    }
    return '';
  })();

  const themeOverride = (() => {
    if (agent === 'charm') {
      return {
        background:
          effectiveTheme === 'dark-black'
            ? '#0a0a0a'
            : effectiveTheme === 'dark'
              ? '#1f2937'
              : '#ffffff',
        selectionBackground: 'rgba(96, 165, 250, 0.35)',
        selectionForeground: effectiveTheme === 'light' ? '#0f172a' : '#f9fafb',
      };
    }
    if (agent === 'mistral') {
      return {
        background:
          effectiveTheme === 'dark-black'
            ? '#141820'
            : effectiveTheme === 'dark'
              ? '#202938'
              : '#ffffff',
        selectionBackground: 'rgba(96, 165, 250, 0.35)',
        selectionForeground: effectiveTheme === 'light' ? '#0f172a' : '#f9fafb',
      };
    }
    if (effectiveTheme === 'dark-black') {
      return {
        background: '#000000',
        selectionBackground: 'rgba(96, 165, 250, 0.35)',
        selectionForeground: '#f9fafb',
      };
    }
    return undefined;
  })();

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
