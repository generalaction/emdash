import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CornerDownLeft, ExternalLink, MessageSquare, X } from 'lucide-react';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useEmdashAccount } from '../contexts/EmdashAccountProvider';
import { useGithubContext } from '../contexts/GithubContextProvider';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { Textarea } from './ui/textarea';
import { useToast } from '../hooks/use-toast';
const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1473390363388416230/eRIo1UhylapH94KpqUUp5PDzkLhjBvcnjjyE_JezfHiAyfN3QEbRyEIJaSl8QQUz7Mak';

const DOCS_URL = 'https://docs.emdash.sh/bring-your-own-infrastructure';

interface AccessRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  githubUser?: { login?: string; name?: string; email?: string } | null;
  userEmail?: string;
}

const AccessRequestModal: React.FC<AccessRequestModalProps> = ({
  isOpen,
  onClose,
  githubUser,
  userEmail,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const [companyName, setCompanyName] = useState('');
  const [infrastructure, setInfrastructure] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setContactEmail(userEmail || githubUser?.email || '');
    } else {
      setCompanyName('');
      setInfrastructure('');
      setContactEmail('');
      setSubmitting(false);
      setError(null);
    }
  }, [isOpen, userEmail, githubUser?.email]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!infrastructure.trim()) {
      setError('Please describe your infrastructure setup.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const lines: string[] = ['**Workspace Provider Access Request**'];
    if (companyName.trim()) lines.push(`Company: ${companyName.trim()}`);
    lines.push(`Infrastructure: ${infrastructure.trim()}`);
    if (contactEmail.trim()) lines.push(`Contact: ${contactEmail.trim()}`);

    const githubLogin = githubUser?.login?.trim();
    const githubName = githubUser?.name?.trim();
    if (githubLogin || githubName) {
      const parts: string[] = [];
      if (githubName && githubLogin) parts.push(`${githubName} (@${githubLogin})`);
      else if (githubLogin) parts.push(`@${githubLogin}`);
      else if (githubName) parts.push(githubName);
      lines.push(`GitHub: ${parts.join(' ')}`);
    }

    try {
      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: lines.join('\n') }),
      });
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      onClose();
      toast({ title: 'Request sent', description: "We'll be in touch soon!" });
    } catch {
      setError('Unable to send request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [companyName, contactEmail, githubUser, infrastructure, onClose, submitting, toast]);

  const handleMetaEnter = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Request workspace provider access"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
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
            className="w-full max-w-lg rounded-xl border border-border bg-white shadow-2xl dark:border-border dark:bg-background"
          >
            <div className="flex items-start justify-between px-6 pb-2 pt-6">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-foreground">
                  Get started with Workspace Providers
                </h2>
                <p className="max-w-md text-xs text-muted-foreground">
                  Tell us about your infrastructure and we&apos;ll help you set up remote workspaces
                  for your team.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-label="Close"
                onClick={onClose}
                size="icon"
                className="text-muted-foreground hover:bg-background/80"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form
              className="space-y-4 px-6 pb-6"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="wp-company" className="text-xs font-medium text-foreground">
                  Company or team name
                </label>
                <Input
                  id="wp-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onKeyDown={handleMetaEnter}
                  placeholder="Acme Inc."
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="wp-infra" className="text-xs font-medium text-foreground">
                  Infrastructure setup
                </label>
                <Textarea
                  id="wp-infra"
                  rows={3}
                  value={infrastructure}
                  onChange={(e) => {
                    setInfrastructure(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={handleMetaEnter}
                  placeholder="e.g. AWS EC2 instances, Hetzner VPS, Docker containers, Kubernetes pods..."
                  className="resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="wp-email" className="text-xs font-medium text-foreground">
                  Contact email
                </label>
                <Input
                  id="wp-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  onKeyDown={handleMetaEnter}
                  placeholder="you@example.com"
                  className="h-9"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="submit"
                  className="gap-2 px-4"
                  disabled={submitting || !infrastructure.trim()}
                >
                  {submitting ? (
                    <>
                      <Spinner size="sm" />
                      <span>Sending…</span>
                    </>
                  ) : (
                    <>
                      <span>Send request</span>
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

export const WorkspaceProviderInfoCard: React.FC = () => {
  const hasWorkspaceProviderAccess = useFeatureFlag('workspace-provider');
  const { isSignedIn, user } = useEmdashAccount();
  const { user: githubUser } = useGithubContext();
  const [isContactOpen, setIsContactOpen] = useState(false);

  if (hasWorkspaceProviderAccess) return null;

  return (
    <>
      <div
        id="workspace-provider-card"
        className="flex flex-col gap-3 rounded-lg border border-muted bg-muted/20 p-4"
      >
        <h3 className="text-sm font-medium text-foreground">Workspace Provider</h3>
        <p className="text-sm text-muted-foreground">
          Run tasks on your own infrastructure. Configure provision and teardown scripts per-project
          in the project config.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => window.electronAPI.openExternal(DOCS_URL)}
          >
            <ExternalLink className="mr-1.5 h-3 w-3" />
            View docs
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIsContactOpen(true)}
          >
            <MessageSquare className="mr-1.5 h-3 w-3" />
            {isSignedIn ? 'Request access' : 'Contact us'}
          </Button>
        </div>
      </div>
      <AccessRequestModal
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
        githubUser={githubUser}
        userEmail={user?.email}
      />
    </>
  );
};
