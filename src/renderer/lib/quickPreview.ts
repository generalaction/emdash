import { startContainerRun, subscribeToWorkspaceRunState, getContainerRunState } from '@/lib/containerRuns';

declare const window: Window & {
  electronAPI: any;
};

export async function isNodeProject(workspacePath?: string): Promise<boolean> {
  if (!workspacePath) return false;
  try {
    const res = await window.electronAPI.fsRead(workspacePath, 'package.json', 64 * 1024);
    return !!(res?.success && typeof res.content === 'string' && res.content.includes('{'));
  } catch {
    return false;
  }
}

export async function ensureCompose(workspacePath?: string): Promise<boolean> {
  if (!workspacePath) return false;
  try {
    const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    for (const file of candidates) {
      const res = await window.electronAPI.fsRead(workspacePath, file, 1);
      if (res?.success) return true;
    }
  } catch {}
  // Write a minimal compose to run npm dev quickly
  const content = `services:\n  web:\n    image: node:20\n    working_dir: /workspace\n    volumes:\n      - ./:/workspace\n    environment:\n      - HOST=0.0.0.0\n      - PORT=3000\n    command: bash -lc \"if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi && npm run dev\"\n    expose:\n      - \"3000\"\n      - \"5173\"\n      - \"8080\"\n      - \"8000\"\n`;
  try {
    const res = await window.electronAPI.fsWriteFile(workspacePath, 'docker-compose.yml', content, false);
    return !!res?.success;
  } catch {
    return false;
  }
}

export async function quickStartPreview(args: {
  workspaceId: string;
  workspacePath: string;
  onPreviewUrl?: (url: string) => void;
}): Promise<{ ok: boolean; error?: string }>
{
  const { workspaceId, workspacePath, onPreviewUrl } = args;
  try {
    const node = await isNodeProject(workspacePath);
    if (!node) return { ok: false, error: 'Not a Node.js project (no package.json).' };
    await ensureCompose(workspacePath);
    await startContainerRun({ workspaceId, workspacePath, mode: 'container' });
    // If already have a preview, use it immediately
    const existing = getContainerRunState(workspaceId);
    if (existing?.previewUrl && onPreviewUrl) onPreviewUrl(existing.previewUrl);
    // Subscribe for preview becoming ready
    const unsubRef: { current: null | (() => void) } = { current: null };
    await new Promise<void>((resolve) => {
      unsubRef.current = subscribeToWorkspaceRunState(workspaceId, (state) => {
        if (state.previewUrl) {
          onPreviewUrl?.(state.previewUrl);
          resolve();
        }
      });
      // Safety timeout
      setTimeout(() => resolve(), 60_000);
    });
    if (unsubRef.current) try { unsubRef.current(); } catch {}
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
