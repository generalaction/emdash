import { useState } from 'react';
import { useToast } from './use-toast';
import { ToastAction } from '../components/ui/toast';
import { ArrowUpRight } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';
type CreatePROptions = {
  workspacePath: string;
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
  const [isCreating, setIsCreating] = useState(false);

  const createPR = async (opts: CreatePROptions) => {
    const {
      workspacePath,
      commitMessage = 'chore: apply workspace changes',
      createBranchIfOnDefault = true,
      branchPrefix = 'orch',
      prOptions,
      onSuccess,
    } = opts;

    setIsCreating(true);
    try {
      // Guard: ensure Electron bridge methods exist (prevents hard crashes in plain web builds)
      const api: any = (window as any).electronAPI;
      if (!api?.gitCommitAndPush || !api?.createPullRequest) {
        const msg = 'PR creation is only available in the Electron app. Start via "npm run d".';
        toast({ title: 'Create PR Unavailable', description: msg, variant: 'destructive' });
        return { success: false, error: 'Electron bridge unavailable' } as any;
      }

      // Auto-generate PR title and description if not provided
      let finalPrOptions = { ...(prOptions || {}) };

      if (!finalPrOptions.title || !finalPrOptions.body) {
        try {
          // Get default branch for comparison
          let defaultBranch = 'main';
          try {
            const branchStatus = await api.getBranchStatus?.({ workspacePath });
            if (branchStatus?.success && branchStatus.defaultBranch) {
              defaultBranch = branchStatus.defaultBranch;
            }
          } catch {}

          // Generate PR content
          if (api.generatePrContent) {
            const generated = await api.generatePrContent({
              workspacePath,
              base: finalPrOptions.base || defaultBranch,
            });

            if (generated?.success && generated.title) {
              finalPrOptions.title = finalPrOptions.title || generated.title;
              finalPrOptions.body = finalPrOptions.body || generated.description || '';
            }
          }
        } catch (error) {
          // Non-fatal: continue with fallback title
          // Silently fail - fallback title will be used
        }
      }

      // Fallback to inferred title if still not set
      if (!finalPrOptions.title) {
        finalPrOptions.title = workspacePath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
      }

      const commitRes = await api.gitCommitAndPush({
        workspacePath,
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
        workspacePath,
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
        } catch {
          // ignore onSuccess errors
        }
      } else {
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('pr_creation_failed', { error_type: res?.error || 'unknown' });
        })();
        const details =
          res?.output && typeof res.output === 'string' ? `\n\nDetails:\n${res.output}` : '';
        toast({
          title: (
            <span className="inline-flex items-center gap-2">
              <img src={githubLogo} alt="GitHub" className="h-5 w-5 rounded-sm object-contain" />
              Failed to Create PR
            </span>
          ),
          description: (res?.error || 'Unknown error') + details,
          variant: 'destructive',
        });
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
      setIsCreating(false);
    }
  };

  return { isCreating, createPR };
}
