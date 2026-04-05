import { useState } from 'react';
import type { GitPlatform } from '../../shared/git/platform';
import { useToast } from './use-toast';
import { ToastAction } from '../components/ui/toast';
import { ArrowUpRight } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';
import { getPlatformLabels } from '../lib/gitPlatformLabels';
type CreatePROptions = {
  taskPath: string;
  commitMessage?: string;
  createBranchIfOnDefault?: boolean;
  branchPrefix?: string;
  gitPlatform?: GitPlatform;
  prOptions?: {
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  };
  onSuccess?: () => Promise<void> | void;
};

export function useCreatePR() {
  const { toast } = useToast();
  const [creatingTaskPath, setCreatingTaskPath] = useState<string | null>(null);

  const isCreatingForTaskPath = (path: string) => creatingTaskPath === path;

  const createPR = async (opts: CreatePROptions) => {
    const labels = getPlatformLabels(opts.gitPlatform);
    const showGithubLogo = opts.gitPlatform !== 'gitlab';
    const {
      taskPath,
      commitMessage: explicitCommitMessage,
      createBranchIfOnDefault = true,
      branchPrefix = 'orch',
      prOptions,
      onSuccess,
    } = opts;

    setCreatingTaskPath(taskPath);
    try {
      // Guard: ensure Electron bridge methods exist (prevents hard crashes in plain web builds)
      const api: any = (window as any).electronAPI;
      if (!api?.gitCommitAndPush || !api?.createPullRequest) {
        const msg = 'PR creation is only available in the Electron app. Start via "pnpm run d".';
        toast({ title: 'Create PR Unavailable', description: msg, variant: 'destructive' });
        return { success: false, error: 'Electron bridge unavailable' } as any;
      }

      const finalPrOptions = { ...(prOptions || {}) };
      const inferredName = taskPath.split(/[/\\]/).filter(Boolean).pop() || 'Task';

      // Start PR content generation in parallel with commit+push when title/body not provided.
      // This saves 10-30s by overlapping the LLM call with git operations.
      let generatePromise: Promise<any> | null = null;
      if (!finalPrOptions.title || !finalPrOptions.body) {
        generatePromise = (async () => {
          try {
            let defaultBranch = 'main';
            try {
              const branchStatus = await api.getBranchStatus?.({ taskPath });
              if (branchStatus?.success && branchStatus.defaultBranch) {
                defaultBranch = branchStatus.defaultBranch;
              }
            } catch {}

            if (api.generatePrContent) {
              return await api.generatePrContent({
                taskPath,
                base: finalPrOptions.base || defaultBranch,
              });
            }
          } catch {
            // Non-fatal: fallback title will be used
          }
          return null;
        })();
      }

      // Use a simple commit message derived from task path while generation runs in parallel
      const commitMessage = explicitCommitMessage || finalPrOptions.title || inferredName;

      // Run commit+push concurrently with PR content generation
      const commitRes = await api.gitCommitAndPush({
        taskPath,
        commitMessage,
        createBranchIfOnDefault,
        branchPrefix,
      });

      if (!commitRes?.success) {
        toast({
          title: 'Commit/Push Failed',
          description: commitRes?.error || 'Unable to push changes.',
          variant: 'destructive',
        });
        return { success: false, error: commitRes?.error || 'Commit/push failed' } as any;
      }

      // Now await the parallel generation result (if started) and apply it
      if (generatePromise) {
        const generated = await generatePromise;
        if (generated?.success) {
          if (!finalPrOptions.title && generated.title) {
            finalPrOptions.title = generated.title;
          }
          if (!finalPrOptions.body && generated.description) {
            finalPrOptions.body = generated.description;
          }
        }
      }

      // Fallback to inferred title if still not set
      if (!finalPrOptions.title) {
        finalPrOptions.title = inferredName;
      }

      const res = await api.createPullRequest({
        taskPath,
        fill: true,
        skipPrePush: true, // commit+push already done above
        ...finalPrOptions,
      });

      if (res?.success) {
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('pr_created');
        })();
        const prUrl = res?.url;
        toast({
          title: `${labels.prNounFull} created successfully!`,
          description: prUrl ? undefined : `${labels.prNoun} created but URL not available.`,
          action: prUrl ? (
            <ToastAction
              altText={labels.viewAction}
              onClick={() => {
                void (async () => {
                  const { captureTelemetry } = await import('../lib/telemetryClient');
                  captureTelemetry('pr_viewed');
                })();
                if (prUrl && window.electronAPI?.openExternal) {
                  window.electronAPI.openExternal(prUrl);
                }
              }}
            >
              <span className="inline-flex items-center gap-1">
                {labels.viewAction}
                <ArrowUpRight className="h-3 w-3" />
              </span>
            </ToastAction>
          ) : undefined,
        });
        try {
          await onSuccess?.();
        } catch {
          // ignore onSuccess errors
        }
      } else {
        // Check if PR creation failed because a PR already exists
        const errorText = (res?.error || '').toLowerCase();
        const outputText = (res?.output || '').toLowerCase();
        const isPrAlreadyExists =
          res?.code === 'PR_ALREADY_EXISTS' ||
          errorText.includes('already exists') ||
          errorText.includes('already has') ||
          errorText.includes('pull request for branch') ||
          outputText.includes('already exists') ||
          outputText.includes('already has') ||
          outputText.includes('pull request for branch');

        // If PR already exists, the push was successful - show success message
        if (isPrAlreadyExists) {
          void (async () => {
            const { captureTelemetry } = await import('../lib/telemetryClient');
            captureTelemetry('pr_push_to_existing');
          })();

          // Try to extract PR URL from the error output
          const urlMatch = (res?.output || '').match(/https?:\/\/github\.com\/[^\s]+\/pull\/\d+/);
          const prUrl = urlMatch ? urlMatch[0] : null;

          toast({
            title: 'Changes pushed successfully!',
            description: `Your changes have been pushed to the existing ${labels.prNounFull.toLowerCase()}.`,
            action: prUrl ? (
              <ToastAction
                altText={labels.viewAction}
                onClick={() => {
                  void (async () => {
                    const { captureTelemetry } = await import('../lib/telemetryClient');
                    captureTelemetry('pr_viewed');
                  })();
                  if (prUrl && window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(prUrl);
                  }
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {labels.viewAction}
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </ToastAction>
            ) : undefined,
          });

          try {
            await onSuccess?.();
          } catch {
            // ignore onSuccess errors
          }
        } else {
          // Show error for other failures
          void (async () => {
            const { captureTelemetry } = await import('../lib/telemetryClient');
            captureTelemetry('pr_creation_failed', { error_type: res?.error || 'unknown' });
          })();
          const details =
            res?.output && typeof res.output === 'string' ? `\n\nDetails:\n${res.output}` : '';
          // Offer a browser fallback if org restricts the GitHub CLI app
          const isOrgRestricted =
            typeof res?.code === 'string' && res.code === 'ORG_AUTH_APP_RESTRICTED';

          toast({
            title: (
              <span className="inline-flex items-center gap-2">
                {showGithubLogo && (
                  <img
                    src={githubLogo}
                    alt="GitHub"
                    className="h-5 w-5 rounded-sm object-contain"
                  />
                )}
                Failed to {labels.createAction}
              </span>
            ),
            description:
              (res?.error || 'Unknown error') +
              (isOrgRestricted
                ? '\n\nYour organization restricts OAuth apps. You can either:\n' +
                  '• Approve the GitHub CLI app in your org settings, or\n' +
                  '• Authenticate gh with a Personal Access Token that has repo scope, or\n' +
                  '• Create the PR in your browser.'
                : '') +
              details,
            variant: 'destructive',
            action: isOrgRestricted ? (
              <ToastAction
                altText="Open in browser"
                onClick={() => {
                  void (async () => {
                    const { captureTelemetry } = await import('../lib/telemetryClient');
                    captureTelemetry('pr_creation_retry_browser');
                  })();
                  // Retry using web flow
                  void createPR({
                    taskPath,
                    commitMessage,
                    createBranchIfOnDefault,
                    branchPrefix,
                    prOptions: { ...(prOptions || {}), web: true, fill: true },
                    onSuccess,
                  });
                }}
              >
                <span className="inline-flex items-center gap-1">
                  Open in browser
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </ToastAction>
            ) : undefined,
          });
        }
      }

      return res as any;
    } catch (err: any) {
      const message = err?.message || String(err) || 'Unknown error';
      toast({
        title: (
          <span className="inline-flex items-center gap-2">
            {showGithubLogo && (
              <img src={githubLogo} alt="GitHub" className="h-5 w-5 rounded-sm object-contain" />
            )}
            Failed to {labels.createAction}
          </span>
        ),
        description: message,
        variant: 'destructive',
      });
      return { success: false, error: message } as any;
    } finally {
      setCreatingTaskPath(null);
    }
  };

  return { isCreatingForTaskPath, createPR };
}
