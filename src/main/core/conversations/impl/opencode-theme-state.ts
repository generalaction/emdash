import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { nativeTheme } from 'electron';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { AgentProviderId } from '@shared/agent-provider-registry';

type OpenCodeThemeMode = 'light' | 'dark';

const OPENCODE_KV_RELATIVE_PATH = 'opencode/kv.json';

async function resolveOpenCodeThemeMode(): Promise<OpenCodeThemeMode> {
  const appTheme = await appSettingsService.get('theme');
  const effectiveTheme = appTheme ?? (nativeTheme.shouldUseDarkColors ? 'emdark' : 'emlight');
  return effectiveTheme === 'emdark' ? 'dark' : 'light';
}

function buildOpenCodeKv(mode: OpenCodeThemeMode): string {
  return `${JSON.stringify({ theme_mode_lock: mode }, null, 2)}\n`;
}

function resolveLocalXdgStateHome(): string {
  const configured = process.env.XDG_STATE_HOME?.trim();
  return configured ? configured.replace(/\/+$/, '') : join(homedir(), '.local', 'state');
}

function resolveRemoteXdgStateHome(profile: RemoteShellProfile): string | undefined {
  const configured = profile.env.XDG_STATE_HOME?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const home = profile.env.HOME;
  if (!home) return undefined;
  return `${home.replace(/\/+$/, '')}/.local/state`;
}

export async function prepareLocalOpenCodeThemeEnv(providerId: AgentProviderId): Promise<void> {
  if (providerId !== 'opencode') return;

  const mode = await resolveOpenCodeThemeMode();
  const xdgStateHome = resolveLocalXdgStateHome();
  const kvPath = join(xdgStateHome, OPENCODE_KV_RELATIVE_PATH);

  await mkdir(join(xdgStateHome, 'opencode'), { recursive: true });
  await writeFile(kvPath, buildOpenCodeKv(mode), 'utf8');
}

export async function prepareSshOpenCodeThemeEnv({
  providerId,
  profile,
  proxy,
}: {
  providerId: AgentProviderId;
  profile: RemoteShellProfile;
  proxy: SshClientProxy;
}): Promise<void> {
  if (providerId !== 'opencode') return;

  const xdgStateHome = resolveRemoteXdgStateHome(profile);
  if (!xdgStateHome) return;

  const mode = await resolveOpenCodeThemeMode();
  const kvPath = `${xdgStateHome}/${OPENCODE_KV_RELATIVE_PATH}`;

  await new SshFileSystem(proxy, '/').write(kvPath, buildOpenCodeKv(mode));
}
