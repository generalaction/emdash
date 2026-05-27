import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import { MermaidDiagramDialog } from './mermaid-diagram-dialog';
import { MermaidDiagramPreview } from './mermaid-diagram-preview';
import { createMermaidRenderId, renderMermaidDiagram } from './mermaid-renderer';

interface MermaidDiagramProps {
  chart: string;
  isDark: boolean;
  compact?: boolean;
}

type RenderState =
  | { kind: 'rendered'; key: string; svg: string }
  | { kind: 'error'; key: string; message: string | null };

const GENERIC_RENDER_ERROR = 'Unable to render Mermaid diagram.';

function errorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message && error.message !== GENERIC_RENDER_ERROR) {
    return error.message;
  }
  if (typeof error === 'string' && error && error !== GENERIC_RENDER_ERROR) {
    return error;
  }
  return null;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart, isDark, compact }) => {
  const id = useMemo(() => createMermaidRenderId(), []);
  const theme = isDark ? 'dark' : 'default';
  const renderKey = `${theme}:${chart}`;
  const [state, setState] = useState<RenderState | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    renderMermaidDiagram({ id, chart, theme })
      .then((svg) => {
        if (!cancelled) setState({ kind: 'rendered', key: renderKey, svg });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', key: renderKey, message: errorMessage(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id, renderKey, theme]);

  const visibleState = state?.key === renderKey ? state : null;

  if (visibleState?.kind === 'error') {
    return (
      <div
        className={cn(
          'my-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive',
          compact && 'my-2 p-2 text-[11px]'
        )}
        role="alert"
      >
        <div className="font-medium">{GENERIC_RENDER_ERROR}</div>
        {visibleState.message && (
          <div className="text-muted-foreground mt-1">{visibleState.message}</div>
        )}
        <pre className="bg-muted/60 text-muted-foreground mt-2 overflow-x-auto rounded p-2">
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  if (!visibleState) {
    return (
      <div
        className={cn(
          'my-3 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground',
          compact && 'my-2 p-2 text-[11px]'
        )}
      >
        Rendering diagram...
      </div>
    );
  }

  return (
    <>
      <MermaidDiagramPreview
        svg={visibleState.svg}
        compact={compact}
        onExpand={() => setIsExpanded(true)}
      />
      <MermaidDiagramDialog
        open={isExpanded}
        svg={visibleState.svg}
        renderKey={visibleState.key}
        onOpenChange={setIsExpanded}
      />
    </>
  );
};
