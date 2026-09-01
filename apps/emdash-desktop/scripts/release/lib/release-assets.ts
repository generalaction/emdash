import { LINUX_ARCHES, LINUX_TARGETS, linuxArtifactName } from './linux-release.ts';
import type { ReleaseChannel } from './version.ts';

export type ReleasePlatform = 'linux' | 'mac' | 'win';

export interface ReleaseIdentity {
  artifactPrefix: string;
  githubChannel: string;
  r2Channel: string;
}

const RELEASE_IDENTITIES: Record<ReleaseChannel, ReleaseIdentity> = {
  stable: {
    artifactPrefix: 'emdash',
    githubChannel: 'latest',
    r2Channel: 'v1-stable',
  },
  canary: {
    artifactPrefix: 'emdash-canary',
    githubChannel: 'canary',
    r2Channel: 'v1-canary',
  },
};

export function releaseIdentity(channel: ReleaseChannel): ReleaseIdentity {
  return RELEASE_IDENTITIES[channel];
}

export function isPlatformReleaseAsset(
  name: string,
  channel: ReleaseChannel,
  platform: ReleasePlatform
): boolean {
  const { artifactPrefix, githubChannel, r2Channel } = releaseIdentity(channel);
  const escapedPrefix = escapeRegExp(artifactPrefix);
  const artifactPattern: Record<ReleasePlatform, string> = {
    linux: '(?:x86_64|amd64|arm64|aarch64)\\.(?:AppImage|deb|rpm)',
    mac: '(?:x64|arm64)\\.(?:dmg|zip)',
    win: 'x64\\.(?:exe|msi)',
  };
  if (new RegExp(`^${escapedPrefix}-${artifactPattern[platform]}(?:\\.blockmap)?$`).test(name)) {
    return true;
  }

  const suffixes: Record<ReleasePlatform, string[]> = {
    linux: ['-linux.yml', '-linux-arm64.yml'],
    mac: ['-mac.yml'],
    win: ['.yml'],
  };
  return [githubChannel, r2Channel].some((manifestChannel) =>
    suffixes[platform].some((suffix) => name === `${manifestChannel}${suffix}`)
  );
}

export function expectedReleaseAssets(channel: ReleaseChannel): string[] {
  const { artifactPrefix, githubChannel, r2Channel } = RELEASE_IDENTITIES[channel];
  const assets = [
    `${artifactPrefix}-x64.exe`,
    `${artifactPrefix}-x64.msi`,
    `${githubChannel}.yml`,
    `${githubChannel}-mac.yml`,
    `${r2Channel}.yml`,
    `${r2Channel}-mac.yml`,
  ];

  for (const arch of LINUX_ARCHES) {
    assets.push(`${artifactPrefix}-${arch}.dmg`, `${artifactPrefix}-${arch}.zip`);
    for (const target of LINUX_TARGETS) {
      assets.push(linuxArtifactName(artifactPrefix, arch, target));
    }

    const linuxSuffix = arch === 'x64' ? '-linux.yml' : '-linux-arm64.yml';
    assets.push(`${githubChannel}${linuxSuffix}`, `${r2Channel}${linuxSuffix}`);
  }

  return assets.sort((a, b) => a.localeCompare(b));
}

export function findMissingReleaseAssets(
  actualAssets: Iterable<string>,
  expectedAssets: Iterable<string>
): string[] {
  const actual = new Set(actualAssets);
  return [...expectedAssets]
    .filter((asset) => !actual.has(asset))
    .sort((a, b) => a.localeCompare(b));
}

export function expectedManifestFiles(
  channel: ReleaseChannel
): ReadonlyMap<string, readonly string[]> {
  const { artifactPrefix, githubChannel, r2Channel } = releaseIdentity(channel);
  const macFiles = LINUX_ARCHES.flatMap((arch) => [
    `${artifactPrefix}-${arch}.zip`,
    `${artifactPrefix}-${arch}.dmg`,
  ]);
  const manifests = new Map<string, readonly string[]>([
    [`${githubChannel}.yml`, [`${artifactPrefix}-x64.exe`]],
    [`${r2Channel}.yml`, [`${artifactPrefix}-x64.exe`]],
    [`${githubChannel}-mac.yml`, macFiles],
    [`${r2Channel}-mac.yml`, macFiles],
  ]);

  for (const arch of LINUX_ARCHES) {
    const suffix = arch === 'x64' ? '-linux.yml' : '-linux-arm64.yml';
    const linuxFiles = LINUX_TARGETS.map((target) =>
      linuxArtifactName(artifactPrefix, arch, target)
    );
    manifests.set(`${githubChannel}${suffix}`, linuxFiles);
    manifests.set(`${r2Channel}${suffix}`, linuxFiles);
  }

  return manifests;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
