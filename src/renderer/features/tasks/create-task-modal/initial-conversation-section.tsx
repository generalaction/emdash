import { X } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Issue } from '@shared/tasks';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { buildTaskContextActions } from '@renderer/features/tasks/conversations/context-actions';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useAttachments } from '@renderer/lib/hooks/use-attachments';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ModalContextBar } from './modal-context-bar';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  imageAttachments: File[];
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

export function buildInitialPrompt(prompt: string, images: InitialPromptImage[]): string {
  const trimmedPrompt = prompt.trim();
  const validImages = images.filter((image) => image.path);
  if (validImages.length === 0) return trimmedPrompt;

  const imagePrompt = validImages.map((image) => `- ${image.name}: ${image.path}`).join('\n');
  return [trimmedPrompt, 'Attached images:', imagePrompt].filter(Boolean).join('\n\n');
}

export function getInitialPromptImages(files: File[]): InitialPromptImage[] {
  return files.map((file) => ({
    name: file.name,
    path: window.electronAPI.getPathForFile(file),
  }));
}

export function useInitialConversationState(connectionId?: string): InitialConversationState {
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  const {
    attachments,
    removeAttachment,
    handlePaste,
    handleDrop,
    handleDragOver,
    reset,
  } = useAttachments();
  return {
    provider: providerId,
    setProvider: setProviderOverride,
    prompt,
    setPrompt,
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
  connectionId?: string;
}

export function InitialConversationField({
  state,
  linkedIssue,
  connectionId,
}: InitialConversationFieldProps) {
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const { value: reviewPrompt } = useAppSettingsKey('reviewPrompt');
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, reviewPrompt),
    [linkedIssue, reviewPrompt]
  );

  const handleActionClick = (text: string) => {
    state.setPrompt(state.prompt ? `${state.prompt}\n${text}` : text);
  };

  const openPreview = (file: File) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') setPreview({ name: file.name, src: reader.result });
    });
    reader.readAsDataURL(file);
  };

  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setPreview(null);
  };

  const previewPortal = preview
    ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.name} preview`}
          onClick={() => setPreview(null)}
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
                onClick={() => setPreview(null)}
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
    <Field>
      <FieldLabel>Initial Conversation</FieldLabel>
      <div
        className="flex flex-col border border-border rounded-md"
        onDrop={state.handleImageDrop}
        onDragOver={state.handleImageDragOver}
      >
        <AgentSelector
          value={state.provider}
          onChange={(provider) => state.setProvider(provider)}
          connectionId={connectionId}
          className="rounded-none border-0 border-b"
        />
        <Textarea
          placeholder="Start with a prompt... (optional)"
          value={state.prompt}
          onChange={(e) => state.setPrompt(e.target.value)}
          onPaste={state.handleImagePaste}
          className="min-h-24 resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:border-0"
        />
        {state.imageAttachments.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border p-2">
            {state.imageAttachments.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md bg-background-1 px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  className="truncate text-left text-foreground-muted hover:text-foreground"
                  onClick={() => openPreview(file)}
                >
                  {file.name}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => state.removeImageAttachment(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <ModalContextBar actions={contextActions} onActionClick={handleActionClick} />
      </div>
      {previewPortal}
    </Field>
  );
}
