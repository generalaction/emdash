import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useToast } from '../hooks/use-toast';
import { useTheme } from '../hooks/useTheme';
import { ChatTerminal } from './ChatTerminal';
import { TerminalModeBanner } from './TerminalModeBanner';
import { providerMeta } from '../providers/meta';
import MessageList from './MessageList';
import ProviderBar from './ProviderBar';
import useCodexStream from '../hooks/useCodexStream';
import useClaudeStream from '../hooks/useClaudeStream';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { type Provider } from '../types';
import { buildAttachmentsSection, buildImageAttachmentsSection } from '../lib/attachments';
import { Workspace, Message } from '../types/chat';
import { ProviderConfig } from '../types/connections';

declare const window: Window & {
  electronAPI: {
    codexCheckInstallation: () => Promise<{
      success: boolean;
      isInstalled?: boolean;
      error?: string;
    }>;
    codexCreateAgent: (
      workspaceId: string,
      worktreePath: string
    ) => Promise<{ success: boolean; agent?: any; error?: string }>;
    saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  };
};

interface SSHInfo {
  enabled: boolean;
  host: string;
  user: string;
  remotePath: string;
  port?: number;
  keyPath?: string;
}

interface Props {
  workspace: Workspace;
  projectName: string;
  className?: string;
  initialProvider?: Provider;
  paneId?: string; // Optional pane ID for split pane isolation
  sshInfo?: SSHInfo;
  compact?: boolean; // Compact mode for floating window
}

// Helper to build shell command with flags based on provider config
const buildShellCommand = (providerId: Provider): string => {
  const baseCli = providerMeta[providerId].cli;
  if (!baseCli) return '';

  try {
    const saved = localStorage.getItem('emdash.providerConfig');
    if (!saved) return baseCli;

    const config: ProviderConfig = JSON.parse(saved);

    // Map provider to their skip permissions flag
    const flagMap: Record<string, string> = {
      claude: '--dangerously-skip-permissions',
      codex: '--yolo',
      droid: '--skip-permissions-unsafe',
      amp: '--dangerously-allow-all',
    };

    // Check if skip permissions is enabled for this provider
    const providerConfig = config[providerId as keyof ProviderConfig];
    if (providerConfig && (providerConfig as any)?.skipPermissions) {
      const flag = flagMap[providerId];
      if (flag) {
        return `${baseCli} ${flag}`;
      }
    }

    return baseCli;
  } catch (err) {
    console.error('Failed to build shell command:', err);
    return baseCli;
  }
};

const ChatInterface: React.FC<Props> = ({
  workspace,
  projectName,
  className,
  initialProvider,
  paneId,
  sshInfo,
  compact = false,
}) => {
  // Use paneId if provided, otherwise use workspace.id for backwards compatibility
  const effectiveWorkspaceId = paneId || workspace.id;

  console.log('[ChatInterface] Mounted with:', {
    workspaceId: workspace.id,
    paneId,
    effectiveWorkspaceId,
    initialProvider,
  });
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const [inputValue, setInputValue] = useState('');
  const [imageAttachments, setImageAttachments] = useState<string[]>([]);
  const [isCodexInstalled, setIsCodexInstalled] = useState<boolean | null>(null);
  const [isClaudeInstalled, setIsClaudeInstalled] = useState<boolean | null>(null);
  const [claudeInstructions, setClaudeInstructions] = useState<string | null>(null);
  const [agentCreated, setAgentCreated] = useState(false);
  const [provider, setProvider] = useState<Provider>(initialProvider || 'codex');
  const [lockedProvider, setLockedProvider] = useState<Provider | null>(null);
  const [hasDroidActivity, setHasDroidActivity] = useState(false);
  const [hasGeminiActivity, setHasGeminiActivity] = useState(false);
  const [hasCursorActivity, setHasCursorActivity] = useState(false);
  const [hasCopilotActivity, setHasCopilotActivity] = useState(false);
  const [cliStartFailed, setCliStartFailed] = useState(false);
  const initializedConversationRef = useRef<string | null>(null);

  const codexStream = useCodexStream(
    // Disable Codex chat stream when Codex is terminal-only
    providerMeta.codex.terminalOnly
      ? null
      : {
          workspaceId: effectiveWorkspaceId,
          workspacePath: workspace.path,
        }
  );

  const claudeStream = useClaudeStream(
    provider === 'claude' && !providerMeta.claude.terminalOnly
      ? { workspaceId: effectiveWorkspaceId, workspacePath: workspace.path }
      : null
  );
  const activeStream = provider === 'codex' ? codexStream : claudeStream;

  useEffect(() => {
    initializedConversationRef.current = null;
    setCliStartFailed(false);
  }, [effectiveWorkspaceId]);

  // On workspace change, restore last-selected provider (including Droid).
  // If a locked provider exists (including Droid), prefer locked.
  // If initialProvider is provided, use it as the highest priority.
  useEffect(() => {
    try {
      const lastKey = `provider:last:${effectiveWorkspaceId}`;
      const lockedKey = `provider:locked:${effectiveWorkspaceId}`;
      const last = window.localStorage.getItem(lastKey) as Provider | null;
      const locked = window.localStorage.getItem(lockedKey) as Provider | null;

      setLockedProvider(locked);
      setHasDroidActivity(locked === 'droid');
      setHasGeminiActivity(locked === 'gemini');
      setHasCursorActivity(locked === 'cursor');
      setHasCopilotActivity(locked === 'copilot');
      // Priority: initialProvider > locked > last > default
      if (initialProvider) {
        setProvider(initialProvider);
      } else {
        const validProviders: Provider[] = [
          'qwen',
          'codex',
          'claude',
          'droid',
          'gemini',
          'cursor',
          'copilot',
          'amp',
          'opencode',
          'charm',
          'auggie',
        ];
        if (locked && (validProviders as string[]).includes(locked)) {
          setProvider(locked as Provider);
        } else if (last && (validProviders as string[]).includes(last)) {
          setProvider(last as Provider);
        } else {
          setProvider('codex');
        }
      }
    } catch {
      setProvider(initialProvider || 'codex');
    }
  }, [effectiveWorkspaceId, initialProvider]);

  // Persist last-selected provider per workspace (including Droid)
  useEffect(() => {
    try {
      window.localStorage.setItem(`provider:last:${effectiveWorkspaceId}`, provider);
    } catch {}
  }, [provider, effectiveWorkspaceId]);

  // When a chat becomes locked (first user message sent or terminal activity), persist the provider
  useEffect(() => {
    try {
      const userLocked =
        provider !== 'droid' &&
        provider !== 'gemini' &&
        provider !== 'cursor' &&
        activeStream.messages &&
        activeStream.messages.some((m) => m.sender === 'user');
      const droidLocked = provider === 'droid' && hasDroidActivity;
      const geminiLocked = provider === 'gemini' && hasGeminiActivity;
      const cursorLocked = provider === 'cursor' && hasCursorActivity;
      const copilotLocked = provider === 'copilot' && hasCopilotActivity;

      if (userLocked || droidLocked || geminiLocked || cursorLocked || copilotLocked) {
        window.localStorage.setItem(`provider:locked:${effectiveWorkspaceId}`, provider);
        setLockedProvider(provider);
      }
    } catch {}
  }, [
    provider,
    effectiveWorkspaceId,
    activeStream.messages,
    hasDroidActivity,
    hasGeminiActivity,
    hasCursorActivity,
  ]);

  // Check Claude Code installation when selected
  useEffect(() => {
    let cancelled = false;
    if (provider !== 'claude') {
      setIsClaudeInstalled(null);
      setClaudeInstructions(null);
      return;
    }
    (async () => {
      try {
        const res = await (window as any).electronAPI.agentCheckInstallation?.('claude');
        if (cancelled) return;
        if (res?.success) {
          setIsClaudeInstalled(!!res.isInstalled);
          if (!res.isInstalled) {
            const inst = await (window as any).electronAPI.agentGetInstallationInstructions?.(
              'claude'
            );
            setClaudeInstructions(
              inst?.instructions ||
                'Install: npm install -g @anthropic-ai/claude-code\nThen run: claude and use /login'
            );
          } else {
            setClaudeInstructions(null);
          }
        } else {
          setIsClaudeInstalled(false);
        }
      } catch {
        setIsClaudeInstalled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, effectiveWorkspaceId]);

  // When switching providers, ensure other streams are stopped
  useEffect(() => {
    (async () => {
      try {
        if (provider !== 'codex')
          await (window as any).electronAPI.codexStopStream?.(effectiveWorkspaceId);
        if (provider !== 'claude')
          await (window as any).electronAPI.agentStopStream?.({
            providerId: 'claude',
            workspaceId: effectiveWorkspaceId,
          });
      } catch {}
    })();
  }, [provider, effectiveWorkspaceId]);

  useEffect(() => {
    if (!codexStream.isReady) return;

    const convoId = codexStream.conversationId;
    if (!convoId) return;
    if (initializedConversationRef.current === convoId) return;

    initializedConversationRef.current = convoId;

    // Check if we need to add a welcome message
    // This runs when messages are loaded but could be empty or contain initial prompt
    const checkForWelcomeMessage = async () => {
      if (codexStream.messages.length === 0) {
        // Check database directly for any existing messages to see if there's an initial prompt
        try {
          const messagesResult = await window.electronAPI.getMessages(convoId);
          if (messagesResult.success && messagesResult.messages) {
            const hasInitialPrompt = messagesResult.messages.some((msg: any) => {
              try {
                const metadata = JSON.parse(msg.metadata || '{}');
                return metadata.isInitialPrompt;
              } catch {
                return false;
              }
            });

            // No welcome message needed
          }
        } catch (error) {
          console.error('Failed to check for welcome message:', error);
        }
      }
    };

    checkForWelcomeMessage();
  }, [
    codexStream.isReady,
    codexStream.conversationId,
    codexStream.messages.length,
    codexStream.appendMessage,
    workspace.name,
  ]);

  useEffect(() => {
    const initializeCodex = async () => {
      try {
        const installResult = await window.electronAPI.codexCheckInstallation();
        if (installResult.success) {
          setIsCodexInstalled(installResult.isInstalled ?? false);

          if (installResult.isInstalled) {
            const agentResult = await window.electronAPI.codexCreateAgent(
              workspace.id,
              workspace.path
            );
            if (agentResult.success) {
              setAgentCreated(true);
              const { log } = await import('../lib/logger');
              log.info('Codex agent created for workspace:', workspace.name);
            } else {
              console.error('Failed to create Codex agent:', agentResult.error);
              toast({
                title: 'Error',
                description: 'Failed to create Codex agent. Please try again.',
                variant: 'destructive',
              });
            }
          }
        } else {
          console.error('Failed to check Codex installation:', installResult.error);
        }
      } catch (error) {
        console.error('Error initializing Codex:', error);
      }
    };

    initializeCodex();
  }, [workspace.id, workspace.path, workspace.name, toast]);

  // Basic Claude installer check (optional UX). We'll rely on user to install as needed.
  // We still gate sending by agentCreated (workspace+conversation ready).

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    if (provider === 'claude' && isClaudeInstalled === false) {
      toast({
        title: 'Claude Code not installed',
        description: 'Install Claude Code CLI and login first. See instructions below.',
        variant: 'destructive',
      });
      return;
    }

    const activeConversationId =
      provider === 'codex' ? codexStream.conversationId : claudeStream.conversationId;
    if (!activeConversationId) return;

    const messageWithContext = inputValue;

    const attachmentsSection = await buildAttachmentsSection(workspace.path, inputValue, {
      maxFiles: 6,
      maxBytesPerFile: 200 * 1024,
    });
    const imageSection = buildImageAttachmentsSection(workspace.path, imageAttachments);

    const result =
      provider === 'codex'
        ? await codexStream.send(messageWithContext, attachmentsSection + imageSection)
        : await claudeStream.send(messageWithContext, attachmentsSection + imageSection);
    if (!result.success) {
      if (result.error && result.error !== 'stream-in-progress') {
        toast({
          title: 'Communication Error',
          description: 'Failed to start Codex stream. Please try again.',
          variant: 'destructive',
        });
      }
      return;
    }

    setInputValue('');
    setImageAttachments([]);
  };

  const handleCancelStream = async () => {
    if (!codexStream.isStreaming && !claudeStream.isStreaming) return;
    const result = provider === 'codex' ? await codexStream.cancel() : await claudeStream.cancel();
    if (!result.success) {
      toast({
        title: 'Cancel Failed',
        description: 'Unable to stop Codex stream. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const streamingOutputForList =
    activeStream.isStreaming || activeStream.streamingOutput ? activeStream.streamingOutput : null;
  // Allow switching providers freely while in Droid mode
  const providerLocked = lockedProvider !== null;

  const isTerminal = providerMeta[provider]?.terminalOnly === true;

  // Track all providers used in this pane to keep their terminals alive
  const [usedProviders, setUsedProviders] = useState<Set<Provider>>(new Set([provider]));

  // Add new providers to the set when they're selected
  useEffect(() => {
    if (isTerminal) {
      setUsedProviders((prev) => {
        if (prev.has(provider)) return prev;
        const next = new Set(prev);
        next.add(provider);
        console.log('[ChatInterface] Added provider:', provider, 'to pane:', effectiveWorkspaceId);
        return next;
      });
    }
  }, [provider, isTerminal, effectiveWorkspaceId]);

  console.log('[ChatInterface] Render:', {
    workspaceId: workspace.id,
    effectiveWorkspaceId,
    provider,
    isTerminal,
    usedProviders: Array.from(usedProviders),
  });

  const initialInjection = useMemo(() => {
    if (!isTerminal) return null;
    const md = workspace.metadata || null;
    const p = (md?.initialPrompt || '').trim();
    if (p) return p;
    const issue = md?.linearIssue;
    if (issue) {
      const parts: string[] = [];
      const line1 = `Linked Linear issue: ${issue.identifier}${issue.title ? ` — ${issue.title}` : ''}`;
      parts.push(line1);
      const details: string[] = [];
      if (issue.state?.name) details.push(`State: ${issue.state.name}`);
      if (issue.assignee?.displayName || issue.assignee?.name)
        details.push(`Assignee: ${issue.assignee?.displayName || issue.assignee?.name}`);
      if (issue.team?.key) details.push(`Team: ${issue.team.key}`);
      if (issue.project?.name) details.push(`Project: ${issue.project.name}`);
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (issue.url) parts.push(`URL: ${issue.url}`);
      const desc = (issue as any)?.description;
      if (typeof desc === 'string' && desc.trim()) {
        const trimmed = desc.trim();
        const max = 1500;
        const body = trimmed.length > max ? trimmed.slice(0, max) + '\n…' : trimmed;
        parts.push('', 'Issue Description:', body);
      }
      return parts.join('\n');
    }
    return null;
  }, [isTerminal, workspace.metadata]);

  useInitialPromptInjection({
    workspaceId: effectiveWorkspaceId,
    providerId: provider,
    prompt: initialInjection,
    enabled: isTerminal,
  });

  // Ensure a provider is stored for this workspace so fallbacks can subscribe immediately
  useEffect(() => {
    try {
      localStorage.setItem(`workspaceProvider:${effectiveWorkspaceId}`, provider);
    } catch {}
  }, [provider, effectiveWorkspaceId]);

  // Handler for switching providers - unlocks the provider and switches
  const handleProviderChange = useCallback(
    async (newProvider: Provider) => {
      console.log('[ChatInterface] handleProviderChange START:', {
        from: provider,
        to: newProvider,
        effectiveWorkspaceId,
      });

      // Clear the locked provider state to allow switching
      try {
        window.localStorage.removeItem(`provider:locked:${effectiveWorkspaceId}`);
        setLockedProvider(null);
        console.log('[ChatInterface] Cleared locked provider');
      } catch (err) {
        console.error('[ChatInterface] Error clearing locked provider:', err);
      }

      // Stop any active streams
      try {
        console.log('[ChatInterface] Stopping streams...');
        await (window as any).electronAPI.codexStopStream?.(effectiveWorkspaceId);
        await (window as any).electronAPI.agentStopStream?.({
          providerId: provider,
          workspaceId: effectiveWorkspaceId,
        });
        console.log('[ChatInterface] Streams stopped');
      } catch (err) {
        console.error('[ChatInterface] Error stopping streams:', err);
      }

      // Reset activity flags
      setHasDroidActivity(false);
      setHasGeminiActivity(false);
      setHasCursorActivity(false);
      setHasCopilotActivity(false);
      setCliStartFailed(false);
      console.log('[ChatInterface] Activity flags reset');

      // Switch to the new provider
      // React will handle unmounting the old ChatTerminal and mounting the new one
      console.log('[ChatInterface] Setting new provider:', newProvider);
      setProvider(newProvider);
      console.log('[ChatInterface] handleProviderChange END');
    },
    [effectiveWorkspaceId, provider]
  );

  return (
    <div
      className={`flex h-full flex-col ${compact ? 'bg-transparent' : 'bg-background'} ${className}`}
    >
      {isTerminal ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-4">
            <div className="mx-auto max-w-4xl space-y-2">
              {(() => {
                if (provider === 'codex' && isCodexInstalled === false) {
                  return (
                    <TerminalModeBanner
                      provider={provider as any}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                    />
                  );
                }
                if (provider === 'claude' && isClaudeInstalled === false) {
                  return (
                    <TerminalModeBanner
                      provider={provider as any}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                    />
                  );
                }
                if (provider !== 'codex' && provider !== 'claude' && cliStartFailed) {
                  return (
                    <TerminalModeBanner
                      provider={provider as any}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                    />
                  );
                }
                return null;
              })()}
            </div>
          </div>
          <div className="mt-4 min-h-0 flex-1 px-6">
            <div
              className={`mx-auto h-full max-w-4xl overflow-hidden rounded-md ${
                provider === 'charm'
                  ? effectiveTheme === 'lightsout'
                    ? 'bg-black'
                    : effectiveTheme === 'light'
                      ? 'bg-white'
                      : 'bg-gray-800'
                  : ''
              }`}
            >
              {/* Render terminals for all providers used in this pane */}
              {Array.from(usedProviders).map((p) => {
                const isActive = p === provider;
                console.log('[ChatInterface] Rendering terminal for provider:', {
                  provider: p,
                  isActive,
                  terminalId: `chat-${effectiveWorkspaceId}-${p}`,
                });

                return (
                  <div
                    key={p}
                    style={{ display: isActive ? 'block' : 'none' }}
                    className="h-full w-full"
                  >
                    <ChatTerminal
                      id={`chat-${effectiveWorkspaceId}-${p}`}
                      cwd={workspace.path}
                      shell={buildShellCommand(p)}
                      sshConfig={sshInfo?.enabled ? sshInfo : undefined}
                      onActivity={() => {
                        try {
                          window.localStorage.setItem(`provider:locked:${effectiveWorkspaceId}`, p);
                          if (isActive) {
                            setLockedProvider(p);
                          }
                        } catch {}
                      }}
                      onStartError={() => {
                        if (isActive) {
                          setCliStartFailed(true);
                        }
                      }}
                      onStartSuccess={() => {
                        if (isActive) {
                          setCliStartFailed(false);
                        }
                      }}
                      variant={effectiveTheme === 'light' ? 'light' : 'dark'}
                      themeOverride={
                        effectiveTheme === 'lightsout'
                          ? { background: '#000000' }
                          : p === 'charm'
                            ? { background: effectiveTheme === 'dark' ? '#1f2937' : '#ffffff' }
                            : undefined
                      }
                      contentFilter={
                        p === 'charm' && effectiveTheme === 'light'
                          ? 'invert(1) hue-rotate(180deg) brightness(1.1) contrast(1.05)'
                          : undefined
                      }
                      className="h-full w-full"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : codexStream.isLoading ? (
        <div
          className="flex-1 overflow-y-auto px-6 pb-2 pt-6"
          style={{
            maskImage: 'linear-gradient(to bottom, black 0%, black 93%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 93%, transparent 100%)',
          }}
        >
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex items-center justify-center py-8">
              <div className="font-sans text-sm text-gray-500 dark:text-gray-400">
                Loading conversation...
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {provider === 'claude' && isClaudeInstalled === false ? (
            <div className="px-6 pt-4">
              <div className="mx-auto max-w-4xl">
                <div className="whitespace-pre-wrap rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {claudeInstructions ||
                    'Install Claude Code: npm install -g @anthropic-ai/claude-code\nThen run: claude and use /login'}
                </div>
              </div>
            </div>
          ) : null}
          <MessageList
            messages={activeStream.messages}
            streamingOutput={streamingOutputForList}
            isStreaming={activeStream.isStreaming}
            awaitingThinking={
              provider === 'codex' ? codexStream.awaitingThinking : claudeStream.awaitingThinking
            }
            providerId={provider === 'codex' ? 'codex' : 'claude'}
          />
        </>
      )}

      <ProviderBar
        provider={provider}
        linearIssue={workspace.metadata?.linearIssue || null}
        githubIssue={workspace.metadata?.githubIssue || null}
        onProviderChange={handleProviderChange}
        allowChange={isTerminal ? true : !providerLocked}
        workspaceId={workspace.id}
        workspacePath={workspace.path}
        theme={effectiveTheme === 'light' ? 'light' : 'dark'}
        branch={workspace.branch}
        sshConfig={sshInfo?.enabled ? sshInfo : undefined}
        compact={compact}
      />
    </div>
  );
};

export default ChatInterface;
