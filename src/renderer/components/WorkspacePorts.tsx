import React, { useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { RunnerPortMapping } from '@shared/container/events';

interface Props {
  workspaceId: string;
  ports: Array<RunnerPortMapping & { url?: string }>;
  previewUrl?: string;
  previewService?: string;
}

const WorkspacePorts: React.FC<Props> = ({ workspaceId, ports, previewUrl, previewService }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {}
  };

  return (
    <motion.div
      id={`ws-${workspaceId}-ports`}
      className="border-t border-border/60 bg-muted/30 px-4 py-2"
      initial={reduceMotion ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={reduceMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 font-medium text-foreground">
            Ports
          </span>
          <span>Mapped host → container per service</span>
        </div>
        {previewUrl ? (
          <button
            type="button"
            className="inline-flex items-center rounded border border-primary/60 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            onClick={(e) => {
              e.stopPropagation();
              window.electronAPI.openExternal(previewUrl);
            }}
          >
            Open Preview
            <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {ports?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {ports.map((p) => {
            const key = `${workspaceId}-${p.service}-${p.host}`;
            const url = p.url ?? `http://localhost:${p.host}`;
            const isPreview = p.service === previewService;
            return (
              <div
                key={key}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <span className="font-medium">{p.service}</span>
                {isPreview ? (
                  <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">preview</span>
                ) : null}
                <span className="text-muted-foreground">
                  {p.host} → {p.container}
                </span>
                <button
                  type="button"
                  className="ml-1 inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.electronAPI.openExternal(url);
                  }}
                  title="Open in browser"
                >
                  Open
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopy(url, key);
                  }}
                  title="Copy URL"
                >
                  {copiedKey === key ? (
                    <>
                      Copied
                      <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      Copy
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/40 p-2 text-xs text-muted-foreground">
          No service ports were exposed in docker-compose. Services without ports still run inside
          the Compose network.
        </div>
      )}
    </motion.div>
  );
};

export default WorkspacePorts;
