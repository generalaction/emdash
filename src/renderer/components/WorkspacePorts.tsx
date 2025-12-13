import React, { useEffect, useState } from 'react';
import { ExternalLink, Copy, Check, Globe, Database, Server } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { RunnerPortMapping } from '@shared/container/events';
import { useToast } from '@/hooks/use-toast';
import { useBrowser } from '@/providers/BrowserProvider';

interface Props {
  workspaceId: string;
  workspacePath?: string;
  ports: Array<RunnerPortMapping & { url?: string }>;
  previewUrl?: string;
  previewService?: string;
}

const WorkspacePorts: React.FC<Props> = ({
  workspaceId,
  workspacePath,
  ports,
  previewUrl,
  previewService,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const { toast } = useToast();
  const browser = useBrowser();

  const [hasCompose, setHasCompose] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        const candidates = [
          'docker-compose.yml',
          'docker-compose.yaml',
          'compose.yml',
          'compose.yaml',
        ];
        for (const file of candidates) {
          const res = await api?.fsRead?.(workspacePath || '', file, 1);
          if (!cancelled && res?.success) {
            setHasCompose(true);
            return;
          }
        }
        if (!cancelled) setHasCompose(false);
      } catch {
        if (!cancelled) setHasCompose(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const norm = (s: string) => s.toLowerCase();
  const sorted = [...(ports ?? [])].sort((a, b) => {
    const ap = previewService && norm(previewService) === norm(a.service);
    const bp = previewService && norm(previewService) === norm(b.service);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    const an = norm(a.service);
    const bn = norm(b.service);
    if (an !== bn) return an < bn ? -1 : 1;
    if (a.container !== b.container) return a.container - b.container;
    return a.host - b.host;
  });

  function ServiceIcon({
    name,
    port,
    workspacePath: currentWorkspacePath,
  }: {
    name: string;
    port: number;
    workspacePath?: string;
  }) {
    const [src, setSrc] = React.useState<string | null>(null);
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const api: any = (window as any).electronAPI;
          if (!api?.resolveServiceIcon) return;
          const res = await api.resolveServiceIcon({
            service: name,
            allowNetwork: true,
            workspacePath: currentWorkspacePath,
          });
          if (!cancelled && res?.ok && typeof res.dataUrl === 'string') {
            setSrc(res.dataUrl);
          }
        } catch {}
      })();
      return () => {
        cancelled = true;
      };
    }, [currentWorkspacePath, name]);
    if (src) {
      return <img src={src} alt="" className="h-3.5 w-3.5 rounded-sm" />;
    }
    const webPorts = new Set([80, 443, 3000, 5173, 8080, 8000]);
    const dbPorts = new Set([5432, 3306, 27017, 1433, 1521]);
    if (webPorts.has(port)) return <Globe className="h-3.5 w-3.5" aria-hidden="true" />;
    if (dbPorts.has(port)) return <Database className="h-3.5 w-3.5" aria-hidden="true" />;
    return <Server className="h-3.5 w-3.5" aria-hidden="true" />;
  }

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
      style={{ overflow: 'hidden', display: 'grid' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 font-medium text-foreground">
            Ports
          </span>
          <span>Mapped host → container per service</span>
        </div>
        <div className="inline-flex items-center gap-2">
          {previewUrl ? (
            <>
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
              <button
                type="button"
                className="inline-flex items-center rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  browser.open(previewUrl);
                }}
                title="Open preview in in‑app browser"
              >
                Open In App
                <Globe className="ml-1.5 h-3 w-3" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {sorted?.length ? (
        <div className="flex flex-wrap gap-2 pt-2">
          {sorted.map((p) => {
            const key = `${workspaceId}-${p.service}-${p.host}`;
            const url = p.url ?? `http://localhost:${p.host}`;
            const isPreview = p.service === previewService;
            return (
              <div
                key={key}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ServiceIcon name={p.service} port={p.container} workspacePath={workspacePath} />
                  <span className="font-medium">{p.service}</span>
                </span>
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
                      <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                    </>
                  ) : (
                    <>
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
          {hasCompose ? (
            <>
              <div>No service ports are currently exposed to the host.</div>
            </>
          ) : (
            <div className="space-y-2">
              <div>Live expose requires a docker-compose.yml at the workspace root.</div>
              <button
                type="button"
                className="inline-flex items-center rounded border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted/40"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const api: any = (window as any).electronAPI;
                    const content = `services:\n  web:\n    image: node:20\n    working_dir: /workspace\n    volumes:\n      - ./:/workspace\n    environment:\n      - HOST=0.0.0.0\n      - PORT=3000\n    command: bash -lc \"if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi && npm run dev\"\n    expose:\n      - \"3000\"\n`;
                    const res = await api.fsWriteFile(
                      workspacePath || '',
                      'docker-compose.yml',
                      content,
                      false
                    );
                    if (res?.success) {
                      setHasCompose(true);
                      toast({
                        title: 'docker-compose.yml created',
                        description: 'Stop and reconnect to use Expose controls.',
                      });
                    } else {
                      toast({
                        title: 'Failed to create docker-compose.yml',
                        description: res?.error || 'Unknown error',
                        variant: 'destructive',
                      });
                    }
                  } catch (err: any) {
                    toast({
                      title: 'Failed to create docker-compose.yml',
                      description: err?.message || String(err),
                      variant: 'destructive',
                    });
                  }
                }}
              >
                Create minimal docker-compose.yml
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default WorkspacePorts;
