import { useState } from 'react';
import { useToast } from './use-toast';
import { ToastAction } from '../components/ui/toast';
import { ArrowUpRight } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';

type CreatePROptions = {
  taskPath: string;
  commitMessage?: string;
  createBranchIfOnDefault?: boolean;
  branchPrefix?: string;
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
  // TRACK LOADING PER PATH INSTEAD OF A GLOBAL BOOLEAN
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});

  const createPR = async (opts: CreatePROptions) => {
    const {
      taskPath,
      commitMessage = 'chore: apply task changes',
      createBranchIfOnDefault = true,
      branchPrefix = 'orch',
      prOptions,
      onSuccess,
    } = opts;

    // SET LOADING FOR THIS SPECIFIC PATH
    setLoadingPaths((prev) => ({ ...prev, [taskPath]: true }));

    try {
      const api: any = (window as any).electronAPI;
      if (!api?.gitCommitAndPush || !api?.createPullRequest) {
        const msg = 'PR creation is only available in the Electron app. Start via "pnpm run d".';
        toast({ title: 'Create PR Unavailable', description: msg, variant: 'destructive' });
        return { success: false, error: 'Electron bridge unavailable' } as any;
      }

      const finalPrOptions = { ...(prOptions || {}) };

      if (!finalPrOptions.title || !finalPrOptions.body) {
        try {
          let defaultBranch = 'main';
          try {
            const branchStatus = await api.getBranchStatus?.({ taskPath });
            if (branchStatus?.success && branchStatus.defaultBranch) {
              defaultBranch = branchStatus.defaultBranch;
            }
          } catch {}

          if (api.generatePrContent) {
            const generated = await api.generatePrContent({
              taskPath,
              base: finalPrOptions.base || defaultBranch,
            });

            if (generated?.success && generated.title) {
              finalPrOptions.title = finalPrOptions.title || generated.title;
              finalPrOptions.body = finalPrOptions.body || generated.description || '';
            }
          }
        } catch (error) {}
      }

      if (!finalPrOptions.title) {
        finalPrOptions.title = taskPath.split(/[/\\]/).filter(Boolean).pop() || 'Task';
      }

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

      const res = await api.createPullRequest({
        taskPath,
        fill: true,
        ...finalPrOptions,
      });

      if (res?.success) {
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('pr_created');
        })();
        const prUrl = res?.url;
        toast({
          title: 'Pull request created successfully!',
          description: prUrl ? undefined : 'PR created but URL not available.',
          action: prUrl ? (
            <ToastAction
              altText="View PR"
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
                View PR
                <ArrowUpRight className="h-3 w-3" />
              </span>
            </ToastAction>
          ) : undefined,
        });
        try {
          await onSuccess?.();
        } catch {}
      } else {
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

        if (isPrAlreadyExists) {
          void (async () => {
            const { captureTelemetry } = await import('../lib/telemetryClient');
            captureTelemetry('pr_push_to_existing');
          })();

          const urlMatch = (res?.output || '').match(/https?:\/\/github\.com\/[^\s]+\/pull\/\d+/);
          const prUrl = urlMatch ? urlMatch[0] : null;

          toast({
            title: 'Changes pushed successfully!',
            description: 'Your changes have been pushed to the existing pull request.',
            action: prUrl ? (
              <ToastAction
                altText="View PR"
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
                  View PR
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </ToastAction>
            ) : undefined,
          });

          try {
            await onSuccess?.();
          } catch {}
        } else {
          void (async () => {
            const { captureTelemetry } = await import('../lib/telemetryClient');
            captureTelemetry('pr_creation_failed', { error_type: res?.error || 'unknown' });
          })();
          const details =
            res?.output && typeof res.output === 'string' ? `\n\nDetails:\n${res.output}` : '';
          const isOrgRestricted =
            typeof res?.code === 'string' && res.code === 'ORG_AUTH_APP_RESTRICTED';

          toast({
            title: (
              <span className="inline-flex items-center gap-2">
                <img src={githubLogo} alt="GitHub" className="h-5 w-5 rounded-sm object-contain" />
                Failed to Create PR
              </span>
            ),
            description:
              (res?.error || 'Unknown error') +
              (isOrgRestricted ? '\n\nYour organization restricts OAuth apps...' : '') +
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
            <img src={githubLogo} alt="GitHub" className="h-5 w-5 rounded-sm object-contain" />
            Failed to Create PR
          </span>
        ),
        description: message,
        variant: 'destructive',
      });
      return { success: false, error: message } as any;
    } finally {
      // CLEAR LOADING FOR THIS SPECIFIC PATH
      setLoadingPaths((prev) => ({ ...prev, [taskPath]: false }));
    }
  };

  // UPDATED RETURN: ISCREATING IS NOW A FUNCTION
  return {
    isCreating: (path: string) => !!loadingPaths[path],
    createPR,
  };
}
