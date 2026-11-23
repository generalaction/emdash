import { buildJsonConfigTrustBehavior } from '@emdash/core/services/agent-plugins/api/plugins/helpers';

export const BOB_TRUSTED_FOLDERS_PATH = '.bob/trustedFolders.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Bob Shell 2.x keeps folder trust as
// { "version": 1, "folders": { "<path>": "TRUST_FOLDER" | "TRUST_PARENT" | "DONT_TRUST" } }.
function withBobTrustedFolder(
  config: Record<string, unknown>,
  workspacePath: string
): Record<string, unknown> | null {
  const isV1 = config.version === 1 && isPlainObject(config.folders);
  // Leave a layout this code does not know untouched.
  if (Object.keys(config).length > 0 && !isV1) return null;

  const folders = isPlainObject(config.folders) ? config.folders : {};
  // Keep whatever the user already decided for this folder, including DONT_TRUST.
  if (Object.hasOwn(folders, workspacePath)) return null;

  return { ...config, version: 1, folders: { ...folders, [workspacePath]: 'TRUST_FOLDER' } };
}

export function buildBobTrustBehavior() {
  return buildJsonConfigTrustBehavior({
    configName: BOB_TRUSTED_FOLDERS_PATH,
    withTrustedPath: withBobTrustedFolder,
  });
}
