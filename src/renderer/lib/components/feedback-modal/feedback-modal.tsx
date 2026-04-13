import { CornerDownLeft, Paperclip } from 'lucide-react';
import React, { useCallback } from 'react';
import { useAttachments } from '@renderer/lib/hooks/use-attachments';
import { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Textarea } from '@renderer/lib/ui/textarea';
import { useFeedbackSubmit } from './use-feedback-submit';

type FeedbackModalArgs = {
  blurb?: string;
};

type Props = BaseModalProps<void> & FeedbackModalArgs;

export function FeedbackModal({ onSuccess, blurb }: Props) {
  const { user: githubUser } = useGithubContext();
  const {
    attachments,
    fileInputRef,
    removeAttachment,
    openFilePicker,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    handleDragOver,
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
    onSuccess: () => {
      resetAttachments();
      onSuccess();
    },
  });

  const handleFormSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSubmit(attachments);
    },
    [handleSubmit, attachments]
  );

  const handleMetaEnter = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
      event.preventDefault();
      void handleSubmit(attachments);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex flex-col gap-0.5">
          <DialogTitle>Feedback</DialogTitle>
          {blurb ? <DialogDescription className="text-xs">{blurb}</DialogDescription> : null}
        </div>
      </DialogHeader>
      <DialogContentArea>
        <form
          id="feedback-form"
          className="space-y-4"
          onSubmit={handleFormSubmit}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
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
              onKeyDown={handleMetaEnter}
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
              onKeyDown={handleMetaEnter}
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
              <ul className="space-y-1 text-sm">
                {attachments.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-foreground"
                  >
                    <span className="truncate">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(index)}
                      disabled={submitting}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
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
        <Button
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
            <>
              <span>Send Feedback</span>
              <span className="flex items-center gap-1 rounded border border-white/40 bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground dark:border-white/20 dark:bg-white/5">
                <ShortcutHint settingsKey="confirm" />
              </span>
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
