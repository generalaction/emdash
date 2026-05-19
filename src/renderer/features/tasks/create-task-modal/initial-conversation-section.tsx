import { X } from 'lucide-react';
import type React from 'react';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { INITIAL_PROMPT_IMAGE_MAX_BYTES } from '@shared/conversations';
import type { Issue } from '@shared/tasks';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import {
  buildTaskContextActions,
  type ContextAction,
} from '@renderer/features/tasks/conversations/context-actions';
import { resolveContextActionText } from '@renderer/features/tasks/conversations/resolve-context-action-text';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useAttachments, type Attachment } from '@renderer/lib/hooks/use-attachments';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { appendInitialConversationText } from './initial-conversation-text';
import { ModalContextBar } from './modal-context-bar';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  connectionId?: string;
  imageAttachments: Attachment[];
  removeImageAttachment: (index: number) => void;
  handleImagePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleImageDrop: (event: React.DragEvent<HTMLElement>) => void;
  handleImageDragOver: (event: React.DragEvent<HTMLElement>) => void;
  resetImages: () => void;
};

type ImagePreview = {
  name: string;
  src: string;
};

type InitialPromptImage = {
  name: string;
  path: string;
};

function imageDisplayName(file: File, index: number): string {
  return file.name === 'image.png' ? `Pasted image ${index + 1}.png` : file.name;
}

async function resolveImagePath(file: File): Promise<string> {
  if (file.size > INITIAL_PROMPT_IMAGE_MAX_BYTES) {
    throw new Error('Image is too large');
  }

  const buffer = await file.arrayBuffer();
  return rpc.app.saveInitialPromptImage({
    name: file.name,
    mimeType: file.type,
    data: new Uint8Array(buffer),
  });
}

export async function getInitialPromptImages(
  attachments: Attachment[]
): Promise<InitialPromptImage[]> {
  return Promise.all(
    attachments.map(async (attachment, index) => ({
      name: imageDisplayName(attachment.file, index),
      path: await resolveImagePath(attachment.file),
    }))
  );
}

export function useInitialConversationState(projectId?: string): InitialConversationState {
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  const { attachments, removeAttachment, handlePaste, handleDrop, handleDragOver, reset } =
    useAttachments();
  return {
    provider: providerId,
    setProvider: setProviderOverride,
    prompt,
    setPrompt,
    connectionId,
    imageAttachments: attachments,
    removeImageAttachment: removeAttachment,
    handleImagePaste: handlePaste,
    handleImageDrop: handleDrop,
    handleImageDragOver: handleDragOver,
    resetImages: reset,
  };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: Issue;
  projectId?: string;
}

export function InitialConversationField({
  state,
  linkedIssue,
  projectId,
}: InitialConversationFieldProps) {
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const { value: promptLibrary } = usePromptLibrary();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, undefined, promptLibrary),
    [linkedIssue, promptLibrary]
  );

  const handleActionClick = async (action: ContextAction) => {
    const text = await resolveContextActionText({ action, linkedIssue, projectId });

    state.setPrompt((current) => appendInitialConversationText(current, text));
  };

  const openPreview = (attachment: Attachment, displayName: string) => {
    setPreview({ name: displayName, src: attachment.previewUrl });
  };

  const closePreview = () => {
    setPreview(null);
  };

  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closePreview();
  };

  const previewPortal = preview
    ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.name} preview`}
          onClick={closePreview}
          onKeyDownCapture={handlePreviewKeyDown}
        >
          <div
            className="flex max-h-[calc(100vh-48px)] max-w-[min(1100px,calc(100vw-48px))] flex-col gap-3 rounded-xl border border-white/10 bg-background p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-1 text-sm">
              <span className="truncate text-foreground-muted">{preview.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                autoFocus
                onClick={closePreview}
                aria-label="Close image preview"
              >
                <X className="size-3" />
              </Button>
            </div>
            <img
              src={preview.src}
              alt={preview.name}
              className="max-h-[calc(100vh-120px)] max-w-full rounded-lg object-contain"
            />
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Field>
        <FieldLabel>Initial conversation</FieldLabel>
        <div
          className="flex flex-col border border-border rounded-md"
          onDrop={state.handleImageDrop}
          onDragOver={state.handleImageDragOver}
        >
          <AgentSelector
            value={state.provider}
            onChange={(provider) => state.setProvider(provider)}
            connectionId={state.connectionId}
            className="rounded-none border-0 border-b"
          />
          <Textarea
            placeholder="Start with a prompt... (optional)"
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            onPaste={state.handleImagePaste}
            className="min-h-24 max-h-64 resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:border-0"
          />
          {state.imageAttachments.length > 0 ? (
            <ul className="flex flex-col gap-1 border-t border-border p-2">
              {state.imageAttachments.map((attachment, index) => {
                const displayName = imageDisplayName(attachment.file, index);
                return (
                  <li
                    key={attachment.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-background-1 px-2 py-1 text-xs"
                  >
                    <button
                      type="button"
                      className="truncate text-left text-foreground-muted hover:text-foreground"
                      onClick={() => openPreview(attachment, displayName)}
                    >
                      {displayName}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => state.removeImageAttachment(index)}
                      aria-label={`Remove ${displayName}`}
                    >
                      <X className="size-3" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <ModalContextBar
            actions={contextActions}
            onActionClick={(action) => void handleActionClick(action)}
          />
        </div>
        {previewPortal}
      </Field>
      <Field>
        <div className="flex items-center gap-2">
          <Switch
            checked={state.provider ? autoApproveDefaults.getDefault(state.provider) : false}
            disabled={!state.provider || autoApproveDefaults.loading || autoApproveDefaults.saving}
            onCheckedChange={(checked) => {
              if (state.provider) autoApproveDefaults.setDefault(state.provider, checked);
            }}
          />
          <FieldLabel>Auto-approve permissions</FieldLabel>
        </div>
      </Field>
    </>
  );
}
