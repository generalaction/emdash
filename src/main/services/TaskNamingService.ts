import { spawn } from 'child_process';
import { resolveProviderCommandConfig } from './ptyManager';
import { log } from '../lib/logger';

const NAMING_PROMPT =
  'Output only a short git branch name slug for the following task description. ' +
  'Rules: lowercase letters, numbers, and hyphens only; no spaces; max 40 characters; ' +
  'no leading or trailing hyphens; be concise and descriptive. ' +
  'Output the slug and nothing else.\n\nTask: ';

const TIMEOUT_MS = 15_000;
const MAX_STDOUT_BYTES = 4096;

function normalizeSlug(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .split('\n')[0] // take first line only
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug.length >= 3 ? slug : null;
}

export async function inferTaskNameFromProvider(
  providerId: string,
  initialPrompt: string,
  cwd: string
): Promise<string | null> {
  const resolved = resolveProviderCommandConfig(providerId);
  if (!resolved) return null;

  const { provider, cli } = resolved;
  if (!provider.utilityCliArgs) return null;

  const args = [...provider.utilityCliArgs, `${NAMING_PROMPT}${initialPrompt}`];

  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        log.warn(`[TaskNaming] timed out for provider: ${providerId}`);
        child.kill();
        resolve(null);
      }
    }, TIMEOUT_MS);

    const child = spawn(cli, args, {
      cwd,
      env: process.env as Record<string, string>,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout += chunk.toString();
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      log.debug(`[TaskNaming] stderr from ${providerId}: ${chunk.toString().trim()}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (code !== 0) {
        log.warn(`[TaskNaming] CLI exited with code ${code} for provider: ${providerId}`);
        resolve(null);
        return;
      }

      resolve(normalizeSlug(stdout));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      log.warn(`[TaskNaming] spawn error for ${providerId}: ${err.message}`);
      resolve(null);
    });
  });
}
