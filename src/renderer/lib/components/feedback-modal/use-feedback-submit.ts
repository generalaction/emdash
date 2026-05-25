import { useCallback, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { log } from '@renderer/utils/logger';
import { FEEDBACK_EMAIL_SCHEMA } from './schemas/feedback-email';

const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1473390363388416230/eRIo1UhylapH94KpqUUp5PDzkLhjBvcnjjyE_JezfHiAyfN3QEbRyEIJaSl8QQUz7Mak';

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
}

export function buildFeedbackContent({
  feedback,
  contactEmail,
  githubUser,
  appVersion,
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
    async (attachments: File[]) => {
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

      const content = buildFeedbackContent({
        feedback: trimmedFeedback,
        contactEmail: trimmedContactEmail,
        githubUser,
        appVersion,
      });

      try {
        let response: Response;
        if (attachments.length > 0) {
          const formData = new FormData();
          formData.append('content', content);
          attachments.forEach((file, index) => {
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
