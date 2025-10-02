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
  const [provider, setProvider] = useState<"codex" | "claude" | "droid">(
    "codex"
  );
  const [lockedProvider, setLockedProvider] = useState<
    "codex" | "claude" | "droid" | null
  >(null);
  const [hasDroidActivity, setHasDroidActivity] = useState(false);
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

  // On workspace change, restore last-selected provider (including Droid).
  // If a locked provider exists (including Droid), prefer locked.
  useEffect(() => {
    try {
      const lastKey = `provider:last:${workspace.id}`;
      const lockedKey = `provider:locked:${workspace.id}`;
      const last = window.localStorage.getItem(lastKey) as
        | "codex"
        | "claude"
        | "droid"
        | null;
      const locked = window.localStorage.getItem(lockedKey) as
        | "codex"
        | "claude"
        | "droid"
        | null;

      setLockedProvider(locked);
      setHasDroidActivity(locked === "droid");

      if (locked === "droid") {
        setProvider("droid");
      } else if (last === "droid") {
        setProvider("droid");
      } else if (locked === "codex" || locked === "claude") {
        setProvider(locked);
      } else if (last === "codex" || last === "claude") {
        setProvider(last);
      } else {
        setProvider("codex");
      }
    } catch {
      setProvider("codex");
    }
  }, [workspace.id]);

  // Persist last-selected provider per workspace (including Droid)
  useEffect(() => {
    try {
      window.localStorage.setItem(`provider:last:${workspace.id}`, provider);
    } catch {}
  }, [provider, workspace.id]);

  // When a chat becomes locked (first user message sent or Droid activity), persist the provider
  useEffect(() => {
    try {
      const userLocked =
        provider !== "droid" &&
        activeStream.messages &&
        activeStream.messages.some((m) => m.sender === "user");
      const droidLocked = provider === "droid" && hasDroidActivity;

      if (userLocked || droidLocked) {
        window.localStorage.setItem(
          `provider:locked:${workspace.id}`,
          provider
        );
        setLockedProvider(provider);
      }
    } catch {}
  }, [provider, workspace.id, activeStream.messages, hasDroidActivity]);

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

    // Check if we need to add a welcome message
    // This runs when messages are loaded but could be empty or contain initial prompt
    const checkForWelcomeMessage = async () => {
      if (codexStream.messages.length === 0) {
        // Check database directly for any existing messages to see if there's an initial prompt
        try {
          const messagesResult = await window.electronAPI.getMessages(convoId);
          if (messagesResult.success && messagesResult.messages) {
            const hasInitialPrompt = messagesResult.messages.some(
              (msg: any) => {
                try {
                  const metadata = JSON.parse(msg.metadata || "{}");
                  return metadata.isInitialPrompt;
                } catch {
                  return false;
                }
              }
            );

            // Only add welcome message if there's no initial prompt and no messages at all
            if (!hasInitialPrompt && messagesResult.messages.length === 0) {
              const welcomeMessage: Message = {
                id: `welcome-${Date.now()}`,
                content: `Hello! You're working in workspace **${workspace.name}**. What can the agent do for you?`,
                sender: "agent",
                timestamp: new Date(),
              };

              await window.electronAPI.saveMessage({
                id: welcomeMessage.id,
                conversationId: convoId,
                content: welcomeMessage.content,
                sender: welcomeMessage.sender,
                metadata: JSON.stringify({ isWelcome: true }),
              });

              codexStream.appendMessage(welcomeMessage);
            }
          }
        } catch (error) {
          console.error("Failed to check for welcome message:", error);
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
  const providerLocked = lockedProvider !== null;

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-gray-800 ${className}`}
    >
      {provider === "droid" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-6 pt-4">
            <div className="max-w-4xl mx-auto">
              <div className="rounded-md border border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 p-3 text-sm">
                <div className="whitespace-pre-wrap">
                  Interact with Droid in the terminal below. To install and get
                  started, see the Factory CLI Quickstart:
                </div>
                <button
                  type="button"
                  onClick={() =>
                    window.electronAPI.openExternal(
                      "https://docs.factory.ai/cli/getting-started/quickstart"
                    )
                  }
                  className="mt-1 underline text-gray-800 hover:text-gray-600 dark:text-gray-200 dark:hover:text-gray-100"
                >
                  https://docs.factory.ai/cli/getting-started/quickstart
                </button>
                <div className="mt-2 text-xs opacity-90">
                  Note: The Droid terminal session now persists while the app is
                  open; leaving and returning to this chat will restore its
                  output. Closing the app will terminate the session.
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 px-6 mt-4">
            <div className="max-w-4xl mx-auto h-full rounded-md overflow-hidden">
              <TerminalPane
                id={`droid-main-${workspace.id}`}
                cwd={workspace.path}
                shell="droid"
                keepAlive={true}
                onActivity={() => {
                  try {
                    setHasDroidActivity(true);
                    window.localStorage.setItem(
                      `provider:locked:${workspace.id}`,
                      "droid"
                    );
                    setLockedProvider("droid");
                  } catch {}
                }}
                variant="light"
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
        isLoading={provider === "droid" ? false : activeStream.isStreaming}
        loadingSeconds={provider === "droid" ? 0 : activeStream.seconds}
        isCodexInstalled={isCodexInstalled}
        agentCreated={agentCreated}
        workspacePath={workspace.path}
        provider={provider}
        onProviderChange={(p) => setProvider(p)}
        selectDisabled={providerLocked}
        disabled={
          provider === "droid" ||
          (provider === "claude" && isClaudeInstalled === false)
        }
      />
    </div>
  );
};

export default ChatInterface;
