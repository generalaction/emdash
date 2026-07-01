import { useCallback, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { buildFeedbackContent, type FeedbackGithubUser } from './build-feedback-content';
import { FEEDBACK_EMAIL_SCHEMA } from './schemas/feedback-email';

const FEEDBACK_MAX_FILES = 10;
const FEEDBACK_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

interface FeedbackSubmitOptions {
  githubUser?: FeedbackGithubUser | null;
  appVersion?: string | null;
  platformDisplayName?: string | null;
  onSuccess: () => void;
}

export function useFeedbackSubmit({
  githubUser,
  appVersion,
  platformDisplayName,
  onSuccess,
}: FeedbackSubmitOptions) {
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contactEmailError, setContactEmailError] = useState<string | null>(null);
  const { toast } = useToast();

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const clearContactEmailError = useCallback(() => {
    setContactEmailError(null);
  }, []);

  const reset = useCallback(() => {
    setFeedbackDetails('');
    setContactEmail('');
    setSubmitting(false);
    setErrorMessage(null);
    setContactEmailError(null);
  }, []);

  const handleSubmit = useCallback(
    async (attachments: File[], loadDiagnosticLog?: () => Promise<File | null>) => {
      const trimmedFeedback = feedbackDetails.trim();
      const trimmedContactEmail = contactEmail.trim();
      if (!trimmedFeedback) {
        setErrorMessage('Please enter some feedback before sending.');
        return;
      }

      const emailValidation = FEEDBACK_EMAIL_SCHEMA.safeParse(trimmedContactEmail);
      if (!emailValidation.success) {
        setContactEmailError(emailValidation.error.issues[0]?.message ?? 'Invalid email address.');
        return;
      }

      setSubmitting(true);
      setErrorMessage(null);
      setContactEmailError(null);

      let diagnosticLog: File | null = null;
      if (loadDiagnosticLog) {
        try {
          diagnosticLog = await loadDiagnosticLog();
        } catch (error) {
          log.error('Failed to read diagnostic logs:', error);
          setErrorMessage('Could not read diagnostic logs. Uncheck the option or try again.');
          setSubmitting(false);
          return;
        }
      }

      const files = diagnosticLog ? [...attachments, diagnosticLog] : attachments;

      if (files.length > FEEDBACK_MAX_FILES) {
        setErrorMessage(
          `Too many attachments (max ${FEEDBACK_MAX_FILES}). Remove some and try again.`
        );
        setSubmitting(false);
        return;
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > FEEDBACK_MAX_PAYLOAD_BYTES) {
        setErrorMessage('Attachments exceed the 8 MB total limit. Remove some and try again.');
        setSubmitting(false);
        return;
      }

      const content = buildFeedbackContent({
        feedback: trimmedFeedback,
        contactEmail: trimmedContactEmail,
        githubUser,
        appVersion,
        platformDisplayName,
        includeDiagnosticLogs: Boolean(diagnosticLog),
      });

      try {
        const payloadFiles = await Promise.all(
          files.map(async (file) => ({
            filename: file.name,
            mimeType: file.type,
            bytes: await file.arrayBuffer(),
          }))
        );

        const result = await rpc.feedback.submit({ content, files: payloadFiles });
        if (!result.success) {
          throw new Error(result.error ?? 'Feedback submission failed');
        }

        onSuccess();
        toast({ title: 'Feedback sent', description: 'Thanks for your feedback!' });
      } catch (error) {
        log.error('Failed to submit feedback:', error);
        setErrorMessage('Unable to send feedback. Please try again.');
        toast({
          title: 'Failed to send feedback',
          description: 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [appVersion, contactEmail, feedbackDetails, githubUser, onSuccess, platformDisplayName, toast]
  );

  return {
    feedbackDetails,
    setFeedbackDetails,
    contactEmail,
    setContactEmail,
    submitting,
    errorMessage,
    contactEmailError,
    clearError,
    clearContactEmailError,
    reset,
    handleSubmit,
    canSubmit: feedbackDetails.trim().length > 0 && !submitting && !contactEmailError,
  };
}
