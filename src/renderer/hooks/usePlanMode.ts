import { useCallback, useEffect, useMemo, useState } from 'react';
import { PLANNING_MD } from '@/lib/planRules';
import { log } from '@/lib/logger';
import { logPlanEvent } from '@/lib/planLogs';

export function usePlanMode(workspaceId: string, workspacePath: string) {
  const key = useMemo(() => `planMode:${workspaceId}`, [workspaceId]);
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  // Persist flag
  useEffect(() => {
    try {
      if (enabled) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {}
  }, [enabled, key]);

  const ensurePlanFile = useCallback(async () => {
    try {
      const rel = '.emdash/planning.md';
      log.info('[plan] writing planning.md', { workspacePath, rel });
      const res = await (window as any).electronAPI.fsWriteFile(
        workspacePath,
        rel,
        PLANNING_MD,
        true
      );
      if (!res?.success) {
        log.warn('[plan] failed to write planning.md', res?.error);
      }
      await logPlanEvent(workspacePath, 'planning.md written');
    } catch (e) {
      log.warn('[plan] failed to write planning.md', e);
    }
  }, [workspacePath]);

  const ensureGitExclude = useCallback(async () => {
    try {
      // Skip for worktrees where .git is a file ("gitdir: ...")
      try {
        const gitRef = await window.electronAPI.fsRead(workspacePath, '.git', 1024);
        if (gitRef?.success && typeof gitRef.content === 'string') {
          const txt = gitRef.content.trim();
          if (/^gitdir:\s*/i.test(txt)) {
            log.info('[plan] worktree detected; skip .git/info/exclude');
            return; // cannot safely write .git/info/exclude here
          }
        }
      } catch {}

      const rel = '.git/info/exclude';
      let current = '';
      try {
        const read = await window.electronAPI.fsRead(workspacePath, rel, 32 * 1024);
        if (read?.success && typeof read.content === 'string') current = read.content;
      } catch {}
      if (current.includes('.emdash/')) return;
      const next = `${current.trimEnd()}\n# emdash plan mode\n.emdash/\n`;
      log.info('[plan] appending .emdash/ to git exclude');
      await (window as any).electronAPI.fsWriteFile(workspacePath, rel, next, true);
      await logPlanEvent(workspacePath, 'updated .git/info/exclude with .emdash/');
    } catch (e) {
      log.warn('[plan] failed to update git exclude', e);
    }
  }, [workspacePath]);

  const removePlanFile = useCallback(async () => {
    try {
      const rel = '.emdash/planning.md';
      await (window as any).electronAPI.fsRemove(workspacePath, rel);
    } catch (e) {
      // ignore
    }
  }, [workspacePath]);

  // Side effects on enable/disable
  useEffect(() => {
    (async () => {
      if (enabled) {
        log.info('[plan] enabled', { workspaceId, workspacePath });
        await logPlanEvent(workspacePath, 'Plan Mode enabled');
        ensureGitExclude();
        ensurePlanFile();
      } else {
        log.info('[plan] disabled', { workspaceId, workspacePath });
        await logPlanEvent(workspacePath, 'Plan Mode disabled');
        removePlanFile();
      }
    })();
  }, [enabled, ensureGitExclude, ensurePlanFile, removePlanFile, workspaceId, workspacePath]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { enabled, setEnabled, toggle } as const;
}
