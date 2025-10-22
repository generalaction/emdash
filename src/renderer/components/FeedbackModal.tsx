import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CornerDownLeft, Paperclip, X } from 'lucide-react';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';

const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1430482776045391912/7r3aZtu7y0safAJfFF0mywzw2uoY_2UhadMf7uv1oJSitIC2eUirWzGHdjiEm7zgdPDt';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  githubUser?: {
    login?: string;
    name?: string;
    html_url?: string;
    email?: string;
  } | null;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, githubUser }) => {
  const shouldReduceMotion = useReducedMotion();
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setFeedbackDetails('');
      setContactEmail('');
      setSubmitting(false);
      setErrorMessage(null);
      setAttachments([]);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (!feedbackDetails.trim() || submitting) {
      if (!feedbackDetails.trim()) {
        setErrorMessage('Please enter some feedback before sending.');
      }
      return;
    }

    if (!DISCORD_WEBHOOK_URL) {
      setErrorMessage('Feedback webhook is not configured.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const trimmedFeedback = feedbackDetails.trim();
    const trimmedContact = contactEmail.trim();

    const metadataLines: string[] = [];
    if (trimmedContact) {
      metadataLines.push(`Contact: ${trimmedContact}`);
    }

    const githubLogin = githubUser?.login?.trim();
    const githubName = githubUser?.name?.trim();
    if (githubLogin || githubName) {
      const summaryParts: string[] = [];
      if (githubName && githubLogin) {
        summaryParts.push(`${githubName} (@${githubLogin})`);
      } else if (githubName) {
        summaryParts.push(githubName);
      } else if (githubLogin) {
        summaryParts.push(`@${githubLogin}`);
      }
      metadataLines.push(`GitHub: ${summaryParts.join(' ')}`);
    }

    const content = [trimmedFeedback, metadataLines.join('\n')].filter(Boolean).join('\n\n');

    try {
      let response: Response;

      if (attachments.length > 0) {
        const formData = new FormData();
        formData.append('content', content);
        attachments.forEach((file, index) => {
          formData.append(`file${index}`, file);
        });
        response = await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
      }

      if (!response.ok) {
        throw new Error(`Discord webhook returned ${response.status}`);
      }

      setFeedbackDetails('');
      setContactEmail('');
      setAttachments([]);
      onClose();
      toast({ title: 'Feedback sent', description: 'Thanks for your feedback!' });
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      setErrorMessage('Unable to send feedback. Please try again.');
      toast({
        title: 'Failed to send feedback',
        description: 'Please try again.',
        variant: 'destructive' as any,
      });
    } finally {
      setSubmitting(false);
    }
  }, [attachments, contactEmail, feedbackDetails, githubUser, onClose, submitting]);

  const handleFormSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSubmit();
    },
    [handleSubmit]
  );

  const handleMetaEnter = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...files]);
      if (errorMessage) {
        setErrorMessage(null);
      }
    }
    // Reset input so the same file can be selected again if needed
    event.target.value = '';
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Feedback"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="w-full max-w-lg transform-gpu rounded-xl border border-gray-200 bg-white shadow-2xl outline-none will-change-transform dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex items-start justify-between px-6 pb-2 pt-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Feedback</h2>
              <Button
                type="button"
                variant="ghost"
                aria-label="Close feedback"
                onClick={onClose}
                size="icon"
                className="text-muted-foreground hover:bg-background/80"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form className="space-y-4 px-6 pb-6" onSubmit={handleFormSubmit}>
              <div className="space-y-1.5">
                <label htmlFor="feedback-details" className="sr-only">
                  Feedback details
                </label>
                <textarea
                  id="feedback-details"
                  rows={5}
                  placeholder="What do you like? How can we improve?"
                  className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  value={feedbackDetails}
                  onChange={(event) => {
                    setFeedbackDetails(event.target.value);
                    if (errorMessage) {
                      setErrorMessage(null);
                    }
                  }}
                  onKeyDown={handleMetaEnter}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="feedback-contact" className="sr-only">
                  Contact email
                </label>
                <input
                  id="feedback-contact"
                  type="text"
                  placeholder="productive@example.com (optional)"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  value={contactEmail}
                  onChange={(event) => {
                    setContactEmail(event.target.value);
                    if (errorMessage) {
                      setErrorMessage(null);
                    }
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
                  onChange={handleAttachmentChange}
                  disabled={submitting}
                />
                {attachments.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {attachments.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="flex items-center justify-between rounded-md border border-dashed border-gray-300 px-3 py-2 text-gray-700 dark:border-gray-700 dark:text-gray-200"
                      >
                        <span className="truncate">{file.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAttachment(index)}
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

              <div className="flex items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAttachmentClick}
                  className="gap-2"
                  disabled={submitting}
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                  <span>Attach image</span>
                </Button>
                <Button
                  type="submit"
                  ref={submitButtonRef}
                  className="gap-2 px-4"
                  disabled={submitting || !feedbackDetails.trim()}
                  aria-busy={submitting}
                >
                  {submitting ? (
                    <>
                      <Spinner size="sm" />
                      <span>Sending…</span>
                    </>
                  ) : (
                    <>
                      <span>Send Feedback</span>
                      <span className="flex items-center gap-1 rounded border border-white/40 bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground dark:border-white/20 dark:bg-white/5">
                        <span>⌘</span>
                        <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default FeedbackModal;
