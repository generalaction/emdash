import { buildJsonConfigTrustBehavior } from '@emdash/core/services/agent-plugins/api/plugins/helpers';

export const BOB_TRUSTED_FOLDERS_PATH = '.bob/trustedFolders.json';

const SUPPORTED_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripTrailingSeparators(folder: string): string {
  return folder.replace(/[\\/]+$/, '');
}

/** True when `workspacePath` is `root` itself or lives beneath it (POSIX or Windows separators). */
function isSameOrInside(workspacePath: string, root: string): boolean {
  const base = stripTrailingSeparators(root);
  // Stripping a filesystem root such as `/` leaves nothing: it contains every absolute path.
  if (!base) return root.length > 0;
  if (!workspacePath.startsWith(base)) return false;
  const rest = workspacePath.slice(base.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('\\');
}

function parentOf(folder: string): string {
  const base = stripTrailingSeparators(folder);
  const cut = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (cut < 0) return '';
  return cut === 0 ? base.slice(0, 1) : base.slice(0, cut);
}

/**
 * Mirrors how Bob Shell 2.x resolves a folder: a `TRUST_FOLDER` entry covers that folder and
 * everything beneath it, and a `TRUST_PARENT` entry trusts the *parent* of the listed folder.
 */
function isAlreadyTrusted(folders: Record<string, unknown>, workspacePath: string): boolean {
  return Object.entries(folders).some(([folder, level]) => {
    if (level === 'TRUST_FOLDER') return isSameOrInside(workspacePath, folder);
    if (level === 'TRUST_PARENT') return isSameOrInside(workspacePath, parentOf(folder));
    return false;
  });
}

/**
 * `bob chat` asks "Do you trust this folder?" the first time it opens a directory, which for
 * Emdash means once per task worktree. Bob Shell 2.x keeps the answers in
 * `~/.bob/trustedFolders.json`:
 *
 *   { "version": 1, "folders": { "/abs/path": "TRUST_FOLDER" | "TRUST_PARENT" | "DONT_TRUST" } }
 *
 * Only that layout is written. A decision the user already made for the worktree itself
 * (including `DONT_TRUST`, which Bob applies to that exact folder) is kept, and nothing is added
 * when existing entries already make the worktree trusted.
 */
function withBobTrustedFolder(
  config: Record<string, unknown>,
  workspacePath: string
): Record<string, unknown> | null {
  const isEmpty = Object.keys(config).length === 0;
  if (!isEmpty && (config.version !== SUPPORTED_VERSION || !isRecord(config.folders))) return null;

  const folders = isRecord(config.folders) ? config.folders : {};
  if (Object.hasOwn(folders, workspacePath)) return null;
  if (isAlreadyTrusted(folders, workspacePath)) return null;

  return {
    ...config,
    version: SUPPORTED_VERSION,
    folders: { ...folders, [workspacePath]: 'TRUST_FOLDER' },
  };
}

export function buildBobTrustBehavior() {
  return buildJsonConfigTrustBehavior({
    configName: BOB_TRUSTED_FOLDERS_PATH,
    withTrustedPath: withBobTrustedFolder,
  });
}
