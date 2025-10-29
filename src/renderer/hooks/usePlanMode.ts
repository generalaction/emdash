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
      // Hidden policy file in .emdash/
      const hiddenRel = '.emdash/planning.md';
      log.info('[plan] writing policy (hidden)', { workspacePath, hiddenRel });
      const resHidden = await (window as any).electronAPI.fsWriteFile(
        workspacePath,
        hiddenRel,
        PLANNING_MD,
        true
      );
      if (!resHidden?.success) {
        log.warn('[plan] failed to write hidden planning.md', resHidden?.error);
      }
      // Root-level helper for agents that don't read hidden dirs
      const rootRel = 'PLANNING.md';
      log.info('[plan] writing policy (root helper)', { workspacePath, rootRel });
      const rootHeader = '# Plan Mode (Read-only)\n\n';
      const rootBody = `${rootHeader}${PLANNING_MD}`;
      const resRoot = await (window as any).electronAPI.fsWriteFile(
        workspacePath,
        rootRel,
        rootBody,
        true
      );
      if (!resRoot?.success) {
        log.warn('[plan] failed to write root PLANNING.md', resRoot?.error);
      }
      await logPlanEvent(workspacePath, 'planning.md written (hidden + root helper)');
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
      const lines: string[] = [];
      if (!current.includes('.emdash/')) lines.push('.emdash/');
      if (!current.includes('PLANNING.md')) lines.push('PLANNING.md');
      if (lines.length === 0) return;
      const next = `${current.trimEnd()}\n# emdash plan mode\n${lines.join('\n')}\n`;
      log.info('[plan] appending .emdash/ to git exclude');
      await (window as any).electronAPI.fsWriteFile(workspacePath, rel, next, true);
      await logPlanEvent(workspacePath, 'updated .git/info/exclude with .emdash/');
    } catch (e) {
      log.warn('[plan] failed to update git exclude', e);
    }
  }, [workspacePath]);

  const removePlanFile = useCallback(async () => {
    try {
      const hiddenRel = '.emdash/planning.md';
      await (window as any).electronAPI.fsRemove(workspacePath, hiddenRel);
      const rootRel = 'PLANNING.md';
      await (window as any).electronAPI.fsRemove(workspacePath, rootRel);
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
        await ensurePlanFile();
        try {
          const lock = await (window as any).electronAPI.planApplyLock(workspacePath);
          if (!lock?.success) log.warn('[plan] failed to apply lock', lock?.error);
          else
            await logPlanEvent(
              workspacePath,
              `Applied read-only lock (changed=${lock.changed ?? 0})`
            );
        } catch (e) {
          log.warn('[plan] planApplyLock error', e);
        }
      } else {
        log.info('[plan] disabled', { workspaceId, workspacePath });
        await logPlanEvent(workspacePath, 'Plan Mode disabled');
        try {
          const unlock = await (window as any).electronAPI.planReleaseLock(workspacePath);
          if (!unlock?.success) log.warn('[plan] failed to release lock', unlock?.error);
          else
            await logPlanEvent(
              workspacePath,
              `Released read-only lock (restored=${unlock.restored ?? 0})`
            );
        } catch (e) {
          log.warn('[plan] planReleaseLock error', e);
        }
        removePlanFile();
      }
    })();
  }, [enabled, ensureGitExclude, ensurePlanFile, removePlanFile, workspaceId, workspacePath]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { enabled, setEnabled, toggle } as const;
}
