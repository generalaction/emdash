import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CornerDownLeft, X } from 'lucide-react';
import { Button } from './ui/button';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const shouldReduceMotion = useReducedMotion();
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

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

  const handleMetaEnter = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
      event.preventDefault();
      submitButtonRef.current?.click();
    }
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
            <div className="flex items-start justify-between px-6 pt-6 pb-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Feedback</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Tell us what’s working well or what could be better. Thank you!
                </p>
              </div>
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

            <form
              className="space-y-4 px-6 pb-6"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="feedback-details" className="sr-only">
                  Feedback details
                </label>
                <textarea
                  id="feedback-details"
                  rows={5}
                  placeholder="Share your thoughts…"
                  className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  onKeyDown={handleMetaEnter}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="feedback-contact" className="sr-only">
                  Contact email
                </label>
                <input
                  id="feedback-contact"
                  type="email"
                  placeholder="productive@example.com (optional)"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  onKeyDown={handleMetaEnter}
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" ref={submitButtonRef} className="gap-2 px-4">
                  <span>Send Feedback</span>
                  <span className="flex items-center gap-1 rounded border border-white/40 bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground dark:border-white/20 dark:bg-white/5">
                    <span>⌘</span>
                    <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                  </span>
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
