import React, { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import ChatInput from "./ChatInput";
import MessageList from "./MessageList";
import useCodexStream from "../hooks/useCodexStream";
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

const ChatInterface: React.FC<Props> = ({ workspace, projectName, className }) => {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");
  const [isCodexInstalled, setIsCodexInstalled] = useState<boolean | null>(null);
  const [agentCreated, setAgentCreated] = useState(false);
  const initializedConversationRef = useRef<string | null>(null);

  const codexStream = useCodexStream({
    workspaceId: workspace.id,
    workspacePath: workspace.path,
  });

  useEffect(() => {
    initializedConversationRef.current = null;
  }, [workspace.id]);

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

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    if (!codexStream.conversationId) return;

    const attachmentsSection = await buildAttachmentsSection(
      workspace.path,
      inputValue,
      {
        maxFiles: 6,
        maxBytesPerFile: 200 * 1024,
      }
    );

    const result = await codexStream.send(inputValue, attachmentsSection);
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
    if (!codexStream.isStreaming) return;

    const result = await codexStream.cancel();
    if (!result.success) {
      toast({
        title: "Cancel Failed",
        description: "Unable to stop Codex stream. Please try again.",
        variant: "destructive",
      });
    }
  };

  const streamingOutputForList =
    codexStream.isStreaming || codexStream.streamingOutput
      ? codexStream.streamingOutput
      : null;

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-lg ${className}`}>
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

      {codexStream.isLoading ? (
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
        <MessageList
          messages={codexStream.messages}
          streamingOutput={streamingOutputForList}
          isStreaming={codexStream.isStreaming}
          awaitingThinking={codexStream.awaitingThinking}
        />
      )}

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSendMessage}
        onCancel={handleCancelStream}
        isLoading={codexStream.isStreaming}
        loadingSeconds={codexStream.seconds}
        isCodexInstalled={isCodexInstalled}
        agentCreated={agentCreated}
        workspacePath={workspace.path}
      />
    </div>
  );
};

export default ChatInterface;
