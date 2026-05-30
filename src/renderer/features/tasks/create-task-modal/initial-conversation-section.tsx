import { CheckCheckIcon, ImageIcon, PlusIcon, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { AddContextPopover } from '@renderer/features/tasks/conversations/add-context-popover';
import {
  buildIssueContextText,
  buildTaskContextActions,
} from '@renderer/features/tasks/conversations/context-actions';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useAttachments, type Attachment } from '@renderer/lib/hooks/use-attachments';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { ContainedImage } from '@renderer/lib/ui/contained-image';
import { Field } from '@renderer/lib/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ZoomableContentDialog } from '@renderer/lib/ui/zoomable-content-dialog';
import { cn } from '@renderer/utils/utils';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { INITIAL_PROMPT_IMAGE_MAX_BYTES, type InitialPromptImage } from '@shared/conversations';
import type { Issue } from '@shared/tasks';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { appendInitialConversationText } from './initial-conversation-text';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  issueContext: string | null;
  setIssueContext: (ctx: string | null) => void;
  imageAttachments: Attachment[];
  removeImageAttachment: (index: number) => void;
  isImageDraggingOver: boolean;
  handleImagePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleImageDrop: (event: React.DragEvent<HTMLElement>) => void;
  handleImageDragOver: (event: React.DragEvent<HTMLElement>) => void;
  handleImageDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  handleImageDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  resetImages: () => void;
  connectionId?: string;
};

function imageDisplayName(file: File, index: number): string {
  return file.name && file.name !== 'image.png' ? file.name : `Pasted image ${index + 1}.png`;
}

function formatImageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function saveInitialPromptImage(file: File): Promise<string> {
  if (file.size > INITIAL_PROMPT_IMAGE_MAX_BYTES) {
    throw new Error(`Image "${file.name}" is larger than 25 MB.`);
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
      path: await saveInitialPromptImage(attachment.file),
    }))
  );
}

export function useInitialConversationState(projectId?: string): InitialConversationState {
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  const [issueContext, setIssueContext] = useState<string | null>(null);
  const {
    attachments,
    isDraggingOver,
    removeAttachment,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    reset,
  } = useAttachments();

  return {
    provider: providerId,
    setProvider: setProviderOverride,
    prompt,
    setPrompt,
    issueContext,
    setIssueContext,
    imageAttachments: attachments,
    removeImageAttachment: removeAttachment,
    isImageDraggingOver: isDraggingOver,
    handleImagePaste: handlePaste,
    handleImageDrop: handleDrop,
    handleImageDragOver: handleDragOver,
    handleImageDragEnter: handleDragEnter,
    handleImageDragLeave: handleDragLeave,
    resetImages: reset,
    connectionId,
  };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: Issue;
  includeIssueContextByDefault: boolean;
}

export function InitialConversationField({
  state,
  linkedIssue,
  includeIssueContextByDefault,
}: InitialConversationFieldProps) {
  const { value: promptLibrary } = usePromptLibrary();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, [], promptLibrary),
    [linkedIssue, promptLibrary]
  );

  useEffect(() => {
    state.setIssueContext(
      includeIssueContextByDefault && linkedIssue ? buildIssueContextText(linkedIssue) : null
    );
    // oxlint-disable-next-line react/exhaustive-deps
  }, [includeIssueContextByDefault, linkedIssue?.identifier, linkedIssue?.provider]);

  const autoApprove = state.provider ? autoApproveDefaults.getDefault(state.provider) : false;
  const previewAttachmentIndex = previewAttachment
    ? state.imageAttachments.findIndex((attachment) => attachment.id === previewAttachment.id)
    : -1;
  const previewAttachmentName = previewAttachment
    ? imageDisplayName(previewAttachment.file, Math.max(0, previewAttachmentIndex))
    : '';

  const handleToggleAutoApprove = () => {
    if (!state.provider) return;
    autoApproveDefaults.setDefault(state.provider, !autoApprove);
  };

  const handleActionClick = async (text: string) => {
    state.setPrompt((current) => appendInitialConversationText(current, text));
  };

  return (
    <Field>
      <div
        className={cn(
          'relative flex flex-col rounded-md border border-border overflow-hidden',
          state.isImageDraggingOver && 'border-primary/60 ring-2 ring-primary/20'
        )}
        onDrop={state.handleImageDrop}
        onDragOver={state.handleImageDragOver}
        onDragEnter={state.handleImageDragEnter}
        onDragLeave={state.handleImageDragLeave}
      >
        {state.isImageDraggingOver ? (
          <div className="bg-primary/5 pointer-events-none absolute inset-0 z-10 flex items-center justify-center backdrop-blur-[1px]">
            <div className="border-primary/25 text-primary flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm">
              <ImageIcon className="size-4" />
              Drop image to attach
            </div>
          </div>
        ) : null}
        <div className="flex w-full items-center justify-between gap-2 px-2 pt-1">
          <AgentSelector
            value={state.provider}
            onChange={(provider) => state.setProvider(provider)}
            connectionId={state.connectionId}
            className="h-6! w-fit! rounded-none border-0 p-0! text-sm!"
            contentClassName="w-64"
          />
          <div className="flex items-center gap-2">
            <AddContextPopover
              actions={contextActions}
              disabled={contextActions.length === 0}
              onApplyAction={handleActionClick}
              renderTrigger={({ disabled: isDisabled }) => (
                <Button variant="ghost" size="icon-xs" disabled={isDisabled}>
                  <PlusIcon className="size-4" />
                </Button>
              )}
            />
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleToggleAutoApprove}
                  disabled={!state.provider}
                  data-active={autoApprove || undefined}
                  className="transition-colors data-active:bg-background-destructive data-active:text-foreground-destructive"
                >
                  <CheckCheckIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Auto approve</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {state.issueContext && linkedIssue && (
          <div className="px-2 py-1">
            <Popover>
              <PopoverTrigger
                className={cn(
                  'group relative flex items-center gap-1.5 rounded bg-background-2 py-0.5 pr-6 pl-2 text-xs text-foreground-muted',
                  'hover:bg-background-3 cursor-pointer'
                )}
              >
                <ProviderLogo provider={linkedIssue.provider} className="size-3 shrink-0" />
                <span className="font-mono">{linkedIssue.identifier}</span>
                {linkedIssue.title && (
                  <span className="max-w-48 truncate text-foreground-passive">
                    {linkedIssue.title}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    state.setIssueContext(null);
                  }}
                  className={cn(
                    'absolute right-1 flex items-center justify-center rounded p-0.5',
                    'text-foreground-passive opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100'
                  )}
                >
                  <X className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" sideOffset={6} className="w-80 gap-0 p-0">
                <pre className="p-3 font-mono text-xs whitespace-pre-wrap text-foreground-passive">
                  {state.issueContext}
                </pre>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <Textarea
          placeholder="Add an optional initial message..."
          value={state.prompt}
          onChange={(e) => state.setPrompt(e.target.value)}
          onPaste={state.handleImagePaste}
          className="max-h-64 min-h-8 resize-none rounded-none border-0 focus-visible:border-0 focus-visible:ring-0"
        />
        {state.imageAttachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-t border-border bg-background-1/40 p-2">
            {state.imageAttachments.map((attachment, index) => {
              const displayName = imageDisplayName(attachment.file, index);
              return (
                <div
                  key={attachment.id}
                  className="group/image-chip hover:border-border-active flex max-w-full items-center gap-2 rounded-md border border-border bg-background pr-1 shadow-xs transition-colors hover:bg-background-1"
                >
                  <button
                    type="button"
                    className="focus-visible:ring-ring flex min-w-0 items-center gap-2 py-1 pr-1 pl-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                    onClick={() => setPreviewAttachment(attachment)}
                    aria-label={`Preview ${displayName}`}
                  >
                    <img
                      src={attachment.previewUrl}
                      alt=""
                      className="size-8 shrink-0 rounded-sm border border-border object-cover"
                    />
                    <span className="min-w-0">
                      <span
                        className="block max-w-40 truncate text-xs font-medium text-foreground"
                        title={displayName}
                      >
                        {displayName}
                      </span>
                      <span className="block text-[11px] text-foreground-muted">
                        {formatImageSize(attachment.file.size)}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-70 transition-opacity group-hover/image-chip:opacity-100"
                    onClick={() => {
                      if (previewAttachment?.id === attachment.id) setPreviewAttachment(null);
                      state.removeImageAttachment(index);
                    }}
                    aria-label={`Remove ${displayName}`}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
        {previewAttachment ? (
          <ZoomableContentDialog
            open={Boolean(previewAttachment)}
            ariaLabel={previewAttachmentName ? `Image: ${previewAttachmentName}` : 'Image preview'}
            contentKey={`${previewAttachment.id}:${previewAttachment.previewUrl}`}
            onOpenChange={(open) => {
              if (!open) setPreviewAttachment(null);
            }}
            contentClassName="h-[min(72dvh,680px)] max-h-[min(72dvh,680px)] w-[min(78vw,920px)] max-w-[min(78vw,920px)] sm:max-w-[min(78vw,920px)]"
            wrapperClassName="rounded-md bg-muted/20"
          >
            {({ fitToView }) => (
              <ContainedImage
                src={previewAttachment.previewUrl}
                alt={previewAttachmentName}
                className="block h-auto max-h-none max-w-none rounded-none"
                onLoad={() => fitToView()}
              />
            )}
          </ZoomableContentDialog>
        ) : null}
      </div>
    </Field>
  );
}
