import { EventEmitter } from 'node:events';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib/logger';

export type HostPreviewEvent = {
  type: 'url' | 'setup';
  workspaceId: string;
  url?: string;
  status?: 'starting' | 'line' | 'done' | 'error';
  line?: string;
};

function detectPackageManager(dir: string): 'pnpm' | 'yarn' | 'npm' {
  try {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    return 'npm';
  } catch {
    return 'npm';
  }
}

function normalizeUrl(u: string): string {
  try {
    const re = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/\S*)?)/i;
    const m = u.match(re);
    if (!m) return '';
    const url = new URL(m[1].replace('0.0.0.0', 'localhost'));
    url.hostname = 'localhost';
    return url.toString();
  } catch {
    return '';
  }
}

class HostPreviewService extends EventEmitter {
  private procs = new Map<string, ChildProcessWithoutNullStreams>();

  async setup(workspaceId: string, workspacePath: string): Promise<{ ok: boolean; error?: string }>{
    const cwd = path.resolve(workspacePath);
    const pm = detectPackageManager(cwd);
    const cmd = pm;
    // Prefer clean install for npm when lockfile exists
    const hasPkgLock = fs.existsSync(path.join(cwd, 'package-lock.json'));
    const hasYarnLock = fs.existsSync(path.join(cwd, 'yarn.lock'));
    const hasPnpmLock = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'));
    const args = pm === 'npm' ? (hasPkgLock ? ['ci'] : ['install']) : ['install'];
    try {
      const child = spawn(cmd, args, { cwd, shell: true, env: { ...process.env, BROWSER: 'none' } });
      this.emit('event', { type: 'setup', workspaceId, status: 'starting' } as HostPreviewEvent);
      const onData = (buf: Buffer) => {
        const line = buf.toString();
        this.emit('event', { type: 'setup', workspaceId, status: 'line', line } as HostPreviewEvent);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      await new Promise<void>((resolve, reject) => {
        child.on('exit', (code) => {
          if (code === 0) resolve(); else reject(new Error(`install exited with ${code}`));
        });
        child.on('error', reject);
      });
      this.emit('event', { type: 'setup', workspaceId, status: 'done' } as HostPreviewEvent);
      return { ok: true };
    } catch (e: any) {
      this.emit('event', { type: 'setup', workspaceId, status: 'error', line: e?.message || String(e) } as HostPreviewEvent);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  start(
    workspaceId: string,
    workspacePath: string,
    opts?: { script?: string; parentProjectPath?: string }
  ): { ok: boolean; error?: string } {
    if (this.procs.has(workspaceId)) return { ok: true };
    const cwd = path.resolve(workspacePath);
    const pm = detectPackageManager(cwd);
    // Preflight: if the workspace lacks node_modules but the parent has it, try linking
    try {
      const parent = (opts?.parentProjectPath || '').trim();
      if (parent) {
        const wsNm = path.join(cwd, 'node_modules');
        const parentNm = path.join(parent, 'node_modules');
        const wsExists = fs.existsSync(wsNm);
        const parentExists = fs.existsSync(parentNm);
        if (!wsExists && parentExists) {
          try {
            const linkType = process.platform === 'win32' ? 'junction' : 'dir';
            fs.symlinkSync(parentNm, wsNm, linkType as any);
            log.info?.('[hostPreview] linked node_modules', { workspaceId, wsNm, parentNm, linkType });
          } catch (e) {
            log.warn?.('[hostPreview] failed to link node_modules; will rely on install if needed', e);
          }
        }
      }
    } catch {}
    const pkgPath = path.join(cwd, 'package.json');
    let script = 'dev';
    if (opts?.script && typeof opts.script === 'string' && opts.script.trim()) {
      script = opts.script.trim();
    } else {
      try {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(raw);
        const scripts = (pkg && pkg.scripts) || {};
        const prefs = ['dev', 'start', 'serve', 'preview'];
        for (const k of prefs) {
          if (typeof scripts[k] === 'string') { script = k; break; }
        }
      } catch {}
    }
    const cmd = pm;
    const args = pm === 'npm' ? ['run', script] : [script];
    const env = { ...process.env };
    // Prefer a non-conflicting default dev port (5173) to avoid clashing with the app's own port (often 3000)
    if (!env.PORT) env.PORT = String(5173);
    if (!env.VITE_PORT) env.VITE_PORT = env.PORT;
    // Prevent frameworks from auto-opening external browsers
    if (!env.BROWSER) env.BROWSER = 'none';
    try {
      const child = spawn(cmd, args, { cwd, env, shell: true });
      log.info?.('[hostPreview] start', { workspaceId, cwd, pm, cmd, args, script });
      this.procs.set(workspaceId, child);
      const onData = (buf: Buffer) => {
        const line = buf.toString();
        const url = normalizeUrl(line);
        if (url) {
          const evt: HostPreviewEvent = { type: 'url', workspaceId, url };
          this.emit('event', evt);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', () => {
        this.procs.delete(workspaceId);
      });
      return { ok: true };
    } catch (e: any) {
      log.error('[hostPreview] failed to start', e);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  stop(workspaceId: string): { ok: boolean } {
    const p = this.procs.get(workspaceId);
    if (!p) return { ok: true };
    try {
      p.kill();
    } catch {}
    this.procs.delete(workspaceId);
    return { ok: true };
  }

  onEvent(listener: (evt: HostPreviewEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const hostPreviewService = new HostPreviewService();
