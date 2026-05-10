import { ImageIcon, Paperclip, XIcon } from 'lucide-react';
import React, { useCallback } from 'react';
import { useAttachments } from '@renderer/lib/hooks/use-attachments';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { useFeedbackSubmit } from './use-feedback-submit';

type FeedbackModalArgs = {
  blurb?: string;
};

type Props = BaseModalProps<void> & FeedbackModalArgs;

function AttachmentThumbnail({
  name,
  previewUrl,
  onRemove,
  disabled,
}: {
  name: string;
  previewUrl: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="group relative size-14 shrink-0 overflow-hidden rounded-md border border-border bg-background">
      <img src={previewUrl} alt={name} className="size-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        disabled={disabled}
        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:enabled:opacity-100 disabled:cursor-not-allowed"
      >
        <XIcon className="size-3.5 text-white" />
      </button>
    </div>
  );
}

export function FeedbackModal({ onSuccess, blurb }: Props) {
  const { user: githubUser } = useGithubContext();
  const appVersion = appState.update.currentVersion;
  const {
    attachments,
    isDraggingOver,
    fileInputRef,
    removeAttachment,
    openFilePicker,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    reset: resetAttachments,
  } = useAttachments();

  const {
    feedbackDetails,
    setFeedbackDetails,
    contactEmail,
    setContactEmail,
    submitting,
    errorMessage,
    clearError,
    handleSubmit,
    canSubmit,
  } = useFeedbackSubmit({
    githubUser,
    appVersion,
    onSuccess: () => {
      resetAttachments();
      onSuccess();
    },
  });

  const handleFormSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSubmit(attachments.map((attachment) => attachment.file));
    },
    [handleSubmit, attachments]
  );

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
          <div className="flex flex-col items-center gap-1 text-primary">
            <ImageIcon className="size-6" />
            <span className="text-xs font-medium">Drop image here</span>
          </div>
        </div>
      )}
      <DialogHeader>
        <div className="flex flex-col gap-0.5">
          <DialogTitle>Feedback</DialogTitle>
          {blurb ? <DialogDescription className="text-xs">{blurb}</DialogDescription> : null}
        </div>
      </DialogHeader>
      <DialogContentArea>
        <form id="feedback-form" className="space-y-4 pt-0.5" onSubmit={handleFormSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="feedback-details" className="sr-only">
              Feedback details
            </label>
            <Textarea
              id="feedback-details"
              autoFocus
              rows={5}
              placeholder="What do you like? How can we improve?"
              className="resize-none"
              value={feedbackDetails}
              onChange={(event) => {
                setFeedbackDetails(event.target.value);
                if (errorMessage) clearError();
              }}
              onPaste={handlePaste}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feedback-contact" className="sr-only">
              Contact email
            </label>
            <Input
              id="feedback-contact"
              type="text"
              placeholder="productive@example.com (optional)"
              value={contactEmail}
              onChange={(event) => {
                setContactEmail(event.target.value);
                if (errorMessage) clearError();
              }}
            />
          </div>

          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              multiple
              onChange={handleFileInputChange}
              disabled={submitting}
            />
            {attachments.length > 0 ? (
              <div
                className={cn(
                  'flex flex-wrap gap-2 rounded-md border border-dashed border-border p-2',
                  submitting && 'opacity-50'
                )}
              >
                {attachments.map((attachment, index) => (
                  <AttachmentThumbnail
                    key={attachment.id}
                    name={attachment.file.name}
                    previewUrl={attachment.previewUrl}
                    onRemove={() => removeAttachment(index)}
                    disabled={submitting}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </DialogContentArea>
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={openFilePicker}
          className="gap-2"
          disabled={submitting}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          <span>Attach image</span>
        </Button>
        <ConfirmButton
          type="submit"
          form="feedback-form"
          className="gap-2 px-4"
          disabled={!canSubmit}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              <span>Sending...</span>
            </>
          ) : (
            <span>Send Feedback</span>
          )}
        </ConfirmButton>
      </DialogFooter>
    </div>
  );
}
