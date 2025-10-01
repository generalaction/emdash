import React, { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import ChatInput from "./ChatInput";
import { TerminalPane } from "./TerminalPane";
import MessageList from "./MessageList";
import useCodexStream from "../hooks/useCodexStream";
import useClaudeStream from "../hooks/useClaudeStream";
import { useProviderPreference } from "../hooks/useProviderPreference";
import { buildAttachmentsSection } from "../lib/attachments";
import { Workspace, Message } from "../types/chat";

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
    saveMessage: (
      message: any
    ) => Promise<{ success: boolean; error?: string }>;
  };
};

interface Props {
  workspace: Workspace;
  projectName: string;
  className?: string;
}

const ChatInterface: React.FC<Props> = ({
  workspace,
  projectName,
  className,
}) => {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");
  const [isCodexInstalled, setIsCodexInstalled] = useState<boolean | null>(
    null
  );
  const [isClaudeInstalled, setIsClaudeInstalled] = useState<boolean | null>(
    null
  );
  const [claudeInstructions, setClaudeInstructions] = useState<string | null>(
    null
  );
  const [agentCreated, setAgentCreated] = useState(false);
  const [provider, setProvider] = useState<"codex" | "claude" | "droid" | "gemini">(
    "codex"
  );
  const initializedConversationRef = useRef<string | null>(null);

  const codexStream = useCodexStream({
    workspaceId: workspace.id,
    workspacePath: workspace.path,
  });

  const claudeStream = useClaudeStream(
    provider === "claude"
      ? { workspaceId: workspace.id, workspacePath: workspace.path }
      : null
  );
  const activeStream = provider === "codex" ? codexStream : claudeStream;

  useEffect(() => {
    initializedConversationRef.current = null;
  }, [workspace.id]);

  // On workspace change, restore locked provider if present; otherwise default to Codex.
  useEffect(() => {
    try {
      const key = `provider:locked:${workspace.id}`;
      const saved = window.localStorage.getItem(key) as
        | "codex"
        | "claude"
        | "droid"
        | "gemini"
        | null;
      if (saved === "claude" || saved === "codex") {
        setProvider(saved);
      } else {
        setProvider("codex");
      }
    } catch {
      setProvider("codex");
    }
  }, [workspace.id]);

  // When a chat becomes locked (first user message sent), persist the provider (excluding Droid)
  useEffect(() => {
    try {
      const hasLockedProvider =
        provider !== "droid" &&
        activeStream.messages &&
        activeStream.messages.some((m) => m.sender === "user");
      if (hasLockedProvider) {
        window.localStorage.setItem(
          `provider:locked:${workspace.id}`,
          provider
        );
      }
    } catch {}
  }, [provider, workspace.id, activeStream.messages]);

  // Check Claude Code installation when selected
  useEffect(() => {
    let cancelled = false;
    if (provider !== "claude") {
      setIsClaudeInstalled(null);
      setClaudeInstructions(null);
      return;
    }
    (async () => {
      try {
        const res = await (window as any).electronAPI.agentCheckInstallation?.(
          "claude"
        );
        if (cancelled) return;
        if (res?.success) {
          setIsClaudeInstalled(!!res.isInstalled);
          if (!res.isInstalled) {
            const inst = await (
              window as any
            ).electronAPI.agentGetInstallationInstructions?.("claude");
            setClaudeInstructions(
              inst?.instructions ||
                "Install: npm install -g @anthropic-ai/claude-code\nThen run: claude and use /login"
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
  }, [provider, workspace.id]);

  // When switching providers, ensure other streams are stopped
  useEffect(() => {
    (async () => {
      try {
        if (provider !== "codex")
          await (window as any).electronAPI.codexStopStream?.(workspace.id);
        if (provider !== "claude")
          await (window as any).electronAPI.agentStopStream?.({
            providerId: "claude",
            workspaceId: workspace.id,
          });
      } catch {}
    })();
  }, [provider, workspace.id]);

  useEffect(() => {
    if (!codexStream.isReady) return;

    const convoId = codexStream.conversationId;
    if (!convoId) return;
    if (initializedConversationRef.current === convoId) return;

    initializedConversationRef.current = convoId;

    if (codexStream.messages.length === 0) {
      const welcomeMessage: Message = {
        id: `welcome-${Date.now()}`,
        content: `Hello! You're working in workspace **${workspace.name}**. What can the agent do for you?`,
        sender: "agent",
        timestamp: new Date(),
      };

      window.electronAPI
        .saveMessage({
          id: welcomeMessage.id,
          conversationId: convoId,
          content: welcomeMessage.content,
          sender: welcomeMessage.sender,
          metadata: JSON.stringify({ isWelcome: true }),
        })
        .catch((error: unknown) => {
          console.error("Failed to save welcome message:", error);
        })
        .finally(() => {
          codexStream.appendMessage(welcomeMessage);
        });
    }
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
              console.log("Codex agent created for workspace:", workspace.name);
            } else {
              console.error("Failed to create Codex agent:", agentResult.error);
              toast({
                title: "Error",
                description: "Failed to create Codex agent. Please try again.",
                variant: "destructive",
              });
            }
          }
        } else {
          console.error(
            "Failed to check Codex installation:",
            installResult.error
          );
        }
      } catch (error) {
        console.error("Error initializing Codex:", error);
      }
    };

    initializeCodex();
  }, [workspace.id, workspace.path, workspace.name, toast]);

  // Basic Claude installer check (optional UX). We'll rely on user to install as needed.
  // We still gate sending by agentCreated (workspace+conversation ready).

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    if (provider === "claude" && isClaudeInstalled === false) {
      toast({
        title: "Claude Code not installed",
        description:
          "Install Claude Code CLI and login first. See instructions below.",
        variant: "destructive",
      });
      return;
    }

    const activeConversationId =
      provider === "codex"
        ? codexStream.conversationId
        : claudeStream.conversationId;
    if (!activeConversationId) return;

    const attachmentsSection = await buildAttachmentsSection(
      workspace.path,
      inputValue,
      {
        maxFiles: 6,
        maxBytesPerFile: 200 * 1024,
      }
    );

    const result =
      provider === "codex"
        ? await codexStream.send(inputValue, attachmentsSection)
        : await claudeStream.send(inputValue, attachmentsSection);
    if (!result.success) {
      if (result.error && result.error !== "stream-in-progress") {
        toast({
          title: "Communication Error",
          description: "Failed to start Codex stream. Please try again.",
          variant: "destructive",
        });
      }
      return;
    }

    setInputValue("");
  };

  const handleCancelStream = async () => {
    if (!codexStream.isStreaming && !claudeStream.isStreaming) return;
    const result =
      provider === "codex"
        ? await codexStream.cancel()
        : await claudeStream.cancel();
    if (!result.success) {
      toast({
        title: "Cancel Failed",
        description: "Unable to stop Codex stream. Please try again.",
        variant: "destructive",
      });
    }
  };

  const streamingOutputForList =
    activeStream.isStreaming || activeStream.streamingOutput
      ? activeStream.streamingOutput
      : null;
  // Allow switching providers freely while in Droid mode
  const providerLocked =
    provider !== "droid" && provider !== "gemini" &&
    (activeStream.isStreaming ||
      (activeStream.messages &&
        activeStream.messages.some((m) => m.sender === "user")));

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-gray-800 ${className}`}
    >
      <div className="flex items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center space-x-3">
          <Folder className="w-5 h-5 text-gray-600" />
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm font-sans">
              {projectName}
            </h3>
          </div>
        </div>
      </div>

      {provider === "droid" || provider === "gemini" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-6 pt-4">
            <div className="max-w-4xl mx-auto">
              <div className="rounded-md border border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 p-3 text-sm">
                <div className="whitespace-pre-wrap">
                  {provider === 'droid'
                    ? 'Interact with Droid in the terminal below. To install and get started, see the Factory CLI Quickstart:'
                    : 'Interact with Gemini in the terminal below. To install and get started, see the Gemini CLI:'}
                </div>
                <button
                  type="button"
                  onClick={() => window.electronAPI.openExternal(
                    provider === 'droid'
                      ? 'https://docs.factory.ai/cli/getting-started/quickstart'
                      : 'https://github.com/google-gemini/gemini-cli'
                  )}
                  className="mt-1 underline text-gray-800 hover:text-gray-600 dark:text-gray-200 dark:hover:text-gray-100"
                >
                  {provider === 'droid'
                    ? 'https://docs.factory.ai/cli/getting-started/quickstart'
                    : 'https://github.com/google-gemini/gemini-cli'}
                </button>
                <div className="mt-2 text-xs opacity-90">
                  Note: Chat state for terminal-based sessions isn’t persisted;
                  switching chats closes the terminal and its state is not
                  restored.
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 px-6 mt-4">
            <div className="max-w-4xl mx-auto h-full rounded-md overflow-hidden">
              <TerminalPane
                id={`${provider}-main-${workspace.id}`}
                cwd={workspace.path}
                shell={provider === 'droid' ? 'droid' : 'gemini'}
                variant="light"
                workspaceId={workspace.id}
                provider={provider as any}
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      ) : codexStream.isLoading ? (
        <div
          className="flex-1 overflow-y-auto px-6 pt-6 pb-2"
          style={{
            maskImage:
              "linear-gradient(to bottom, black 0%, black 93%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 0%, black 93%, transparent 100%)",
          }}
        >
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500 dark:text-gray-400 text-sm font-sans">
                Loading conversation...
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {provider === "claude" && isClaudeInstalled === false ? (
            <div className="px-6 pt-4">
              <div className="max-w-4xl mx-auto">
                <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm whitespace-pre-wrap">
                  {claudeInstructions ||
                    "Install Claude Code: npm install -g @anthropic-ai/claude-code\nThen run: claude and use /login"}
                </div>
              </div>
            </div>
          ) : null}
          <MessageList
            messages={activeStream.messages}
            streamingOutput={streamingOutputForList}
            isStreaming={activeStream.isStreaming}
            awaitingThinking={
              provider === "codex"
                ? codexStream.awaitingThinking
                : claudeStream.awaitingThinking
            }
            providerId={provider === "codex" ? "codex" : "claude"}
          />
        </>
      )}

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSendMessage}
        onCancel={handleCancelStream}
        isLoading={(provider === "droid" || provider === "gemini") ? false : activeStream.isStreaming}
        loadingSeconds={(provider === "droid" || provider === "gemini") ? 0 : activeStream.seconds}
        isCodexInstalled={isCodexInstalled}
        agentCreated={agentCreated}
        workspacePath={workspace.path}
        provider={provider}
        onProviderChange={(p) => setProvider(p)}
        selectDisabled={providerLocked}
        disabled={
          provider === "droid" || provider === "gemini" ||
          (provider === "claude" && isClaudeInstalled === false)
        }
      />
    </div>
  );
};

export default ChatInterface;
