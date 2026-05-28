import { useCallback, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { log } from '@renderer/utils/logger';
import { FEEDBACK_EMAIL_SCHEMA } from './schemas/feedback-email';

const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1473390363388416230/eRIo1UhylapH94KpqUUp5PDzkLhjBvcnjjyE_JezfHiAyfN3QEbRyEIJaSl8QQUz7Mak';

const DISCORD_MAX_FILES = 10;
const DISCORD_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

interface GithubUser {
  login?: string;
  name?: string;
  html_url?: string;
  email?: string;
}

interface FeedbackSubmitOptions {
  githubUser?: GithubUser | null;
  appVersion?: string | null;
  onSuccess: () => void;
}

interface BuildFeedbackContentOptions {
  feedback: string;
  contactEmail: string;
  githubUser?: GithubUser | null;
  appVersion?: string | null;
  includeDiagnosticLogs?: boolean;
}

export function buildFeedbackContent({
  feedback,
  contactEmail,
  githubUser,
  appVersion,
  includeDiagnosticLogs,
}: BuildFeedbackContentOptions): string {
  const trimmedFeedback = feedback.trim();
  const trimmedContact = contactEmail.trim();
  const metadataLines: string[] = [];

  if (trimmedContact) {
    metadataLines.push(`Contact: ${trimmedContact}`);
  }

  const githubLogin = githubUser?.login?.trim();
  const githubName = githubUser?.name?.trim();
  if (githubLogin || githubName) {
    const parts: string[] = [];
    if (githubName && githubLogin) {
      parts.push(`${githubName} (@${githubLogin})`);
    } else if (githubName) {
      parts.push(githubName);
    } else if (githubLogin) {
      parts.push(`@${githubLogin}`);
    }
    metadataLines.push(`GitHub: ${parts.join(' ')}`);
  }

  const trimmedAppVersion = appVersion?.trim();
  if (trimmedAppVersion) {
    metadataLines.push(`Emdash Version: ${trimmedAppVersion}`);
  }

  if (includeDiagnosticLogs) {
    metadataLines.push('Diagnostic Logs: attached by user opt-in');
  }

  return [trimmedFeedback, metadataLines.join('\n')].filter(Boolean).join('\n\n');
}

export function useFeedbackSubmit({ githubUser, appVersion, onSuccess }: FeedbackSubmitOptions) {
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

      if (files.length > DISCORD_MAX_FILES) {
        setErrorMessage(
          `Too many attachments (max ${DISCORD_MAX_FILES}). Remove some and try again.`
        );
        setSubmitting(false);
        return;
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > DISCORD_MAX_PAYLOAD_BYTES) {
        setErrorMessage('Attachments exceed the 8 MB total limit. Remove some and try again.');
        setSubmitting(false);
        return;
      }

      const content = buildFeedbackContent({
        feedback: trimmedFeedback,
        contactEmail: trimmedContactEmail,
        githubUser,
        appVersion,
        includeDiagnosticLogs: Boolean(diagnosticLog),
      });

      try {
        let response: Response;
        if (files.length > 0) {
          const formData = new FormData();
          formData.append('content', content);
          files.forEach((file, index) => {
            formData.append(`file${index}`, file);
          });
          response = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: formData });
        } else {
          response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
        }

        if (!response.ok) {
          throw new Error(`Discord webhook returned ${response.status}`);
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
    [appVersion, contactEmail, feedbackDetails, githubUser, onSuccess, toast]
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
