import { rpc } from './rpc';

export async function isNodeProject(taskPath?: string): Promise<boolean> {
  if (!taskPath) return false;
  try {
    const res = await rpc.fs.read({ root: taskPath, relPath: 'package.json', maxBytes: 64 * 1024 });
    return !!(res?.success && typeof res.content === 'string' && res.content.includes('{'));
  } catch {
    return false;
  }
}

export async function ensureCompose(taskPath?: string): Promise<boolean> {
  if (!taskPath) return false;
  try {
    const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    for (const file of candidates) {
      const res = await rpc.fs.read({ root: taskPath, relPath: file, maxBytes: 1 });
      if (res?.success) return true;
    }
  } catch {}
  // Write a minimal compose to run npm dev quickly
  const content = `services:\n  web:\n    image: node:20\n    working_dir: /workspace\n    volumes:\n      - ./:/workspace\n    environment:\n      - HOST=0.0.0.0\n      - PORT=3000\n    command: bash -lc \"if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi && npm run dev\"\n    expose:\n      - \"3000\"\n      - \"5173\"\n      - \"8080\"\n      - \"8000\"\n`;
  try {
    const res = await rpc.fs.write({
      root: taskPath,
      relPath: 'docker-compose.yml',
      content,
      mkdirs: false,
    });
    return !!res?.success;
  } catch {
    return false;
  }
}

export async function quickStartPreview(args: {
  taskId: string;
  taskPath: string;
  onPreviewUrl?: (url: string) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const { taskId, taskPath } = args;
  try {
    const node = await isNodeProject(taskPath);
    if (!node) return { ok: false, error: 'Not a Node.js project (no package.json).' };
    await ensureCompose(taskPath);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
