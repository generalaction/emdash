import React from 'react';
import { Folder, GitBranch } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';
import PrPreviewTooltip from './PrPreviewTooltip';
import type { PrInfo } from '../lib/prStatus';

type Props = {
  tasks: Array<{ name: string; pr: PrInfo }>;
};

export const DeletePrNotice: React.FC<Props> = ({ tasks }) => {
  if (!tasks.length) return null;

  const handleOpen = (url?: string) => {
    if (!url) return;
    try {
      window.electronAPI.openExternal(url);
    } catch {}
  };

  return (
    <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-amber-700 dark:text-amber-200" />
        <p className="font-medium">Open PR detected</p>
      </div>
      <div className="space-y-1">
        {tasks.map((ws) => {
          const badge = ws.pr.isDraft ? 'Draft' : 'PR';
          const number = typeof ws.pr.number === 'number' ? ` #${ws.pr.number}` : '';
          const state = ws.pr.state ? ` (${String(ws.pr.state)})` : '';
          const hasValidPr = typeof ws.pr.number === 'number' && typeof ws.pr.url === 'string';

          const prBadge = (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border bg-white/60 px-2 py-0.5 text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:bg-white/10 dark:text-amber-50"
              onClick={(e) => {
                e.stopPropagation();
                handleOpen(ws.pr.url);
              }}
            >
              <img src={githubLogo} alt="GitHub" className="h-4 w-4" />
              {badge}
              {number}
              {state}
            </button>
          );

          return (
            <div
              key={`${ws.name}-${ws.pr.number ?? ws.pr.url ?? 'pr'}`}
              className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-amber-900 dark:bg-amber-500/10 dark:text-amber-50"
            >
              <Folder className="h-4 w-4 fill-amber-700 text-amber-700" />
              <span className="font-medium">{ws.name}</span>
              <span className="text-muted-foreground">—</span>
              {hasValidPr ? (
                <PrPreviewTooltip pr={ws.pr as any}>{prBadge}</PrPreviewTooltip>
              ) : (
                prBadge
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DeletePrNotice;
