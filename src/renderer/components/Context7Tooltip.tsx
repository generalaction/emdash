import React from 'react';
import type { Provider } from '../types';
import { CONTEXT7_INTEGRATION } from '../mcp/context7';
import { Badge } from './ui/badge';
import context7Logo from '../../assets/images/context7.png';

type Props = {
  provider: Provider;
  enabled: boolean;
};

const Context7Tooltip: React.FC<Props> = ({ enabled }) => {
  return (
    <div className="max-w-sm text-xs">
      <div className="flex items-center gap-2">
        <img src={context7Logo} alt="Context7" className="h-4 w-4 rounded-[3px] object-contain" />
        <div className="font-medium">Context7 MCP</div>
      </div>
      <div className="mt-2 border-t border-border/60" />
      <div className="mt-2 text-muted-foreground">
        Context7 lets coding agents fetch up‑to‑date, indexed library docs on demand, improving
        accuracy and reducing hallucinations.
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-tiny text-muted-foreground">
        <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-micro opacity-80">
          Requires setup in your used agent CLIs. Once configured, Emdash auto‑invokes Context7 in
          prompts.
        </span>
      </div>

      <div className="mt-2 border-t border-border/60 pt-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <Badge
              className={
                enabled
                  ? 'border-emerald-600/40 bg-emerald-500/15 text-emerald-700'
                  : 'border-border/60 bg-muted/40 text-muted-foreground'
              }
            >
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
          <button
            type="button"
            onClick={() =>
              (window as any).electronAPI?.openExternal?.(CONTEXT7_INTEGRATION.docsUrl)
            }
            className="text-tiny text-muted-foreground underline-offset-2 hover:underline"
          >
            Open Context7 docs ↗
          </button>
        </div>
      </div>
    </div>
  );
};

export default Context7Tooltip;
