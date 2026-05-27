import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, nativeTheme } from 'electron';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { AgentProviderId } from '@shared/agent-provider-registry';

type OpenCodeThemeMode = 'light' | 'dark';

const OPENCODE_STATE_DIR_NAME = 'opencode-state';
const OPENCODE_KV_RELATIVE_PATH = 'opencode/kv.json';

async function resolveOpenCodeThemeMode(): Promise<OpenCodeThemeMode> {
  const appTheme = await appSettingsService.get('theme');
  const effectiveTheme = appTheme ?? (nativeTheme.shouldUseDarkColors ? 'emdark' : 'emlight');
  return effectiveTheme === 'emdark' ? 'dark' : 'light';
}

function buildOpenCodeKv(mode: OpenCodeThemeMode): string {
  return `${JSON.stringify({ theme_mode_lock: mode }, null, 2)}\n`;
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '');
}

export function withOpenCodeThemeShellSetup(
  shellSetup: string | undefined,
  env: Record<string, string> | undefined
): string | undefined {
  const xdgStateHome = env?.XDG_STATE_HOME;
  if (!xdgStateHome) return shellSetup;

  const exportThemeState = `export XDG_STATE_HOME=${quoteShellArg(xdgStateHome)}`;
  return shellSetup ? `${shellSetup} && ${exportThemeState}` : exportThemeState;
}

export async function prepareLocalOpenCodeThemeEnv(
  providerId: AgentProviderId
): Promise<Record<string, string> | undefined> {
  if (providerId !== 'opencode') return undefined;

  const mode = await resolveOpenCodeThemeMode();
  const xdgStateHome = join(app.getPath('userData'), OPENCODE_STATE_DIR_NAME);
  const kvPath = join(xdgStateHome, OPENCODE_KV_RELATIVE_PATH);

  await mkdir(join(xdgStateHome, 'opencode'), { recursive: true });
  await writeFile(kvPath, buildOpenCodeKv(mode), 'utf8');

  return { XDG_STATE_HOME: xdgStateHome };
}

export async function prepareSshOpenCodeThemeEnv({
  providerId,
  profile,
  proxy,
}: {
  providerId: AgentProviderId;
  profile: RemoteShellProfile;
  proxy: SshClientProxy;
}): Promise<Record<string, string> | undefined> {
  if (providerId !== 'opencode') return undefined;

  const home = profile.env.HOME;
  if (!home) return undefined;

  const mode = await resolveOpenCodeThemeMode();
  const xdgStateHome = `${trimTrailingSlash(home)}/.local/state/emdash/${OPENCODE_STATE_DIR_NAME}`;
  const kvPath = `${xdgStateHome}/${OPENCODE_KV_RELATIVE_PATH}`;

  await new SshFileSystem(proxy, '/').write(kvPath, buildOpenCodeKv(mode));

  return { XDG_STATE_HOME: xdgStateHome };
}
