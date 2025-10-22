import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from './ui/button';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const shouldReduceMotion = useReducedMotion();
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
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Share Feedback
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Tell us what’s working well or what could be better.
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
              className="space-y-5 px-6 py-6"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <div className="space-y-2">
                <label
                  htmlFor="feedback-topic"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Topic
                </label>
                <select
                  id="feedback-topic"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  defaultValue="general"
                >
                  <option value="general">General feedback</option>
                  <option value="bug">Report a bug</option>
                  <option value="feature">Request a feature</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="feedback-summary"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Summary
                </label>
                <input
                  id="feedback-summary"
                  type="text"
                  placeholder="Give a quick headline"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="feedback-details"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Details
                </label>
                <textarea
                  id="feedback-details"
                  rows={5}
                  placeholder="Let us know the details. Include steps to reproduce if reporting a bug."
                  className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="feedback-contact"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Contact (optional)
                </label>
                <input
                  id="feedback-contact"
                  type="email"
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Leave an email if you’d like us to follow up with you.
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  We read every piece of feedback. Thank you!
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onClose}
                    className="text-sm"
                  >
                    Cancel
                  </Button>
                  <Button type="button" disabled>
                    Send Feedback
                  </Button>
                </div>
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
