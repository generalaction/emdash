import { useState, useEffect } from 'react';
import { pickDefaultBranch, type BranchOption } from '../components/BranchSelect';
import { prewarmWorktreeReserve } from '../lib/worktreeUtils';
import type { Project } from '../types/app';
import { rpc } from '../lib/ipc';

interface ProjectBranchOptions {
  projectBranchOptions: BranchOption[];
  projectDefaultBranch: string;
  isLoadingBranches: boolean;
  setProjectDefaultBranch: (branch: string) => void;
}

export function useProjectBranchOptions(project: Project | null): ProjectBranchOptions {
  const [projectBranchOptions, setProjectBranchOptions] = useState<BranchOption[]>([]);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [hasResolvedBranchOptions, setHasResolvedBranchOptions] = useState(false);

  useEffect(() => {
    if (!project) {
      setProjectBranchOptions([]);
      setProjectDefaultBranch('main');
      setHasResolvedBranchOptions(false);
      return;
    }

    const currentRef = project.gitInfo?.baseRef;
    const initialBranch = currentRef || 'main';
    setProjectBranchOptions([{ value: initialBranch, label: initialBranch }]);
    setProjectDefaultBranch(initialBranch);
    setHasResolvedBranchOptions(false);

    let cancelled = false;
    const loadBranches = async () => {
      setIsLoadingBranches(true);
      try {
        let options: BranchOption[];
        if (project.isRemote && project.sshConnectionId) {
          const result = await rpc.ssh.executeCommand(
            project.sshConnectionId,
            'git branch -a --format="%(refname:short)"',
            project.path
          );
          if (cancelled) return;
          if (result.exitCode === 0 && result.stdout) {
            const branches = result.stdout
              .split('\n')
              .map((b) => b.trim())
              .filter((b) => b.length > 0 && !b.includes('HEAD'));
            options = branches.map((b) => ({ value: b, label: b }));
          } else {
            options = [];
          }
        } else {
          const res = await rpc.git.listRemoteBranches({ projectPath: project.path });
          if (cancelled) return;
          if (res.success && res.branches) {
            options = res.branches.map((b) => ({
              value: b.ref,
              label: b.remote ? b.label : `${b.branch} (local)`,
            }));
          } else {
            options = [];
          }
        }

        if (!cancelled && options.length > 0) {
          setProjectBranchOptions(options);
          const defaultBranch = pickDefaultBranch(options, currentRef);
          setProjectDefaultBranch(defaultBranch ?? currentRef ?? 'main');
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
      } finally {
        if (!cancelled) {
          setIsLoadingBranches(false);
          setHasResolvedBranchOptions(true);
        }
      }
    };

    void loadBranches();
    return () => {
      cancelled = true;
    };
  }, [project]);

  // Keep reserves warm for the currently selected base ref
  useEffect(() => {
    if (!project) return;
    if (!hasResolvedBranchOptions) return;
    if (isLoadingBranches) return;
    const preferredBaseRef = (projectDefaultBranch || '').trim();
    const hasPreferredRef = projectBranchOptions.some((o) => o.value === preferredBaseRef);
    const fallbackBaseRef = (project.gitInfo?.baseRef || '').trim() || 'HEAD';
    const baseRefForPrewarm = hasPreferredRef ? preferredBaseRef : fallbackBaseRef;
    prewarmWorktreeReserve(project.id, project.path, project.gitInfo?.isGitRepo, baseRefForPrewarm);
  }, [
    project,
    hasResolvedBranchOptions,
    isLoadingBranches,
    projectDefaultBranch,
    projectBranchOptions,
  ]);

  return { projectBranchOptions, projectDefaultBranch, isLoadingBranches, setProjectDefaultBranch };
}
