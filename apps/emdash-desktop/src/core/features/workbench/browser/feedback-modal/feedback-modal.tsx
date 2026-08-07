import {
  Button,
  Checkbox,
  Dialog,
  Input,
  Spinner,
  Textarea,
  Tooltip,
} from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { ImageIcon, Info, Paperclip, XIcon } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { getHostClient } from '@core/features/workbench/api/browser/host-client';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';
import { cn } from '@core/primitives/styling/browser/cn';
import { useAttachments } from '@renderer/lib/hooks/use-attachments';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { getUpdateStore } from '@renderer/lib/stores/update-store-contribution';
import { useFeedbackSubmit } from './use-feedback-submit';

type FeedbackModalArgs = {
  blurb?: string;
};

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

export function FeedbackModal({ blurb }: FeedbackModalArgs) {
  const controller = useModalController('feedbackModal');
  const [includeDiagnosticLogs, setIncludeDiagnosticLogs] = useState(false);
  const { user: githubUser } = useGithubContext();
  const appVersion = getUpdateStore().currentVersion;
  const { data: platformDisplayName } = useQuery({
    queryKey: ['app', 'platformDisplayName'],
    queryFn: async () => (await getHostClient()).getPlatformDisplayName(),
    staleTime: Infinity,
  });
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
    contactEmailError,
    clearError,
    clearContactEmailError,
    handleSubmit,
    canSubmit,
  } = useFeedbackSubmit({
    githubUser,
    appVersion,
    platformDisplayName,
    onSuccess: () => {
      resetAttachments();
      setIncludeDiagnosticLogs(false);
      controller.complete();
    },
  });

  const handleFormSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const loadDiagnosticLog = includeDiagnosticLogs
        ? async () => {
            const attachment = await (await getHostClient()).getDiagnosticLogAttachment();
            return new File([attachment.content], attachment.filename, {
              type: attachment.mimeType,
            });
          }
        : undefined;
      await handleSubmit(
        attachments.map((attachment) => attachment.file),
        loadDiagnosticLog
      );
    },
    [handleSubmit, attachments, includeDiagnosticLogs]
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
        <div className="border-primary bg-primary/5 absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed">
          <div className="text-primary flex flex-col items-center gap-1">
            <ImageIcon className="size-6" />
            <span className="text-xs font-medium">Drop image here</span>
          </div>
        </div>
      )}
      <Dialog.Header>
        <div className="flex flex-col gap-1">
          <Dialog.Title>Feedback</Dialog.Title>
          {blurb ? <Dialog.Description className="text-xs">{blurb}</Dialog.Description> : null}
        </div>
      </Dialog.Header>
      <Dialog.Body>
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
              aria-invalid={contactEmailError ? 'true' : undefined}
              aria-describedby={contactEmailError ? 'feedback-contact-error' : undefined}
              onChange={(event) => {
                setContactEmail(event.target.value);
                if (errorMessage) clearError();
                if (contactEmailError) clearContactEmailError();
              }}
            />
            {contactEmailError ? (
              <p
                id="feedback-contact-error"
                className="text-xs text-foreground-destructive"
                role="alert"
              >
                {contactEmailError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeDiagnosticLogs}
                  onCheckedChange={(checked) => setIncludeDiagnosticLogs(Boolean(checked))}
                  disabled={submitting}
                />
                <span className="min-w-0">Include diagnostic logs</span>
              </label>
              <Tooltip.Provider delay={150}>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <button
                      type="button"
                      className="text-muted-foreground mt-1 inline-flex size-4 items-center justify-center hover:text-foreground"
                      aria-label="More information about diagnostic logs"
                    >
                      <Info className="size-3.5" aria-hidden="true" />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side="top" className="max-w-xs text-xs">
                    Attaches recent app logs with sensitive details redacted.
                  </Tooltip.Content>
                </Tooltip.Root>
              </Tooltip.Provider>
            </div>

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
            <p className="text-destructive text-sm" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </Dialog.Body>
      <Dialog.Footer className="sm:justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={openFilePicker}
          className="gap-2"
          disabled={submitting}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          <span>Attach image</span>
        </Button>
        <ConfirmButton
          variant="primary"
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
      </Dialog.Footer>
    </div>
  );
}

export const feedbackModal = defineModal<void>()({
  id: 'feedbackModal',
  component: FeedbackModal,
});
