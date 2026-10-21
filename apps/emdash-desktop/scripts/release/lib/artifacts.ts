import { copyFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { ARTIFACT_PREFIX, RELEASE_DIR, UPDATE_CHANNEL } from './config.ts';

interface UpdateManifestFile {
  url: string;
  sha512: string;
  size?: number;
  [key: string]: unknown;
}

interface UpdateManifest {
  version: string;
  files: UpdateManifestFile[];
  path?: string;
  [key: string]: unknown;
}

export interface UpdateManifestFileMetadata {
  url: string;
  sha512: string;
  size?: number;
}

export interface ArtifactFileMetadata {
  sha512: string;
  size: number;
}

function matchFiles(pattern: RegExp, dir = RELEASE_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => pattern.test(f))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function findManifests(channel = UPDATE_CHANNEL, dir = RELEASE_DIR): string[] {
  return matchFiles(new RegExp(`^${channel}.*\\.yml$`), dir);
}

export function findInstallers(prefix = ARTIFACT_PREFIX): string[] {
  return matchFiles(new RegExp(`^${prefix}-.*\\.(dmg|zip|exe|msi|AppImage|deb|rpm)$`));
}

export function findBlockmaps(): string[] {
  return matchFiles(/\.blockmap$/);
}

export function findArtifacts(patterns: string[]): string[] {
  const combined = new RegExp(patterns.map((p) => `(?:${p})`).join('|'));
  return matchFiles(combined);
}

/**
 * Copies each `${sourceChannel}*.yml` in `dir` to a `${targetChannel}*.yml` sibling,
 * returning the paths of the newly created files. No-op when the channels are equal.
 *
 * This is used to produce `v1-stable*.yml` (R2 feed) from `latest*.yml` (GitHub feed)
 * without running a second electron-builder pass — the manifests are identical in content,
 * differing only in filename.
 */
export function duplicateChannelManifests(
  sourceChannel: string,
  targetChannel: string,
  dir = RELEASE_DIR
): string[] {
  if (sourceChannel === targetChannel) return [];
  const sources = findManifests(sourceChannel, dir);
  const created: string[] = [];
  for (const src of sources) {
    const srcName = basename(src);
    const targetName = srcName.replace(sourceChannel, targetChannel);
    const targetPath = join(dir, targetName);
    copyFileSync(src, targetPath);
    created.push(targetPath);
  }
  return created;
}

function parseUpdateManifest(content: string): UpdateManifest {
  const parsed: unknown = parse(content);
  if (!parsed || typeof parsed !== 'object') throw new Error('Update manifest must be an object');
  const manifest = parsed as Record<string, unknown>;
  if (typeof manifest.version !== 'string' || !Array.isArray(manifest.files)) {
    throw new Error('Update manifest must contain a version and files array');
  }
  const files = manifest.files.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid update manifest file entry');
    const file = entry as Record<string, unknown>;
    if (typeof file.url !== 'string' || typeof file.sha512 !== 'string') {
      throw new Error('Update manifest files must contain url and sha512 strings');
    }
    if (
      file.size !== undefined &&
      (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0)
    ) {
      throw new Error('Update manifest file size must be a non-negative integer');
    }
    return file as UpdateManifestFile;
  });
  if (manifest.path !== undefined && typeof manifest.path !== 'string') {
    throw new Error('Update manifest path must be a string');
  }
  return { ...manifest, version: manifest.version, files } as UpdateManifest;
}

export function mergeUpdateManifests(contents: string[]): string {
  if (contents.length === 0) throw new Error('Cannot merge an empty manifest list');
  const manifests = contents.map(parseUpdateManifest);
  const merged: UpdateManifest = structuredClone(manifests[0]);
  const files = new Map<string, UpdateManifestFile>();

  for (const manifest of manifests) {
    if (manifest.version !== merged.version) {
      throw new Error(
        `Cannot merge update manifests for different versions: ${merged.version} and ${manifest.version}`
      );
    }
    for (const file of manifest.files) {
      const existing = files.get(file.url);
      if (existing && existing.sha512 !== file.sha512) {
        throw new Error(`Conflicting checksums for update artifact ${file.url}`);
      }
      files.set(file.url, file);
    }
  }

  merged.files = [...files.values()];
  return stringify(merged, { lineWidth: 0 });
}

export function updateManifestFileUrls(content: string): string[] {
  return parseUpdateManifest(content).files.map((file) => file.url);
}

export function updateManifestFiles(content: string): UpdateManifestFileMetadata[] {
  return parseUpdateManifest(content).files.map(({ url, sha512, size }) => ({
    url,
    sha512,
    ...(size === undefined ? {} : { size }),
  }));
}

export function updateManifestVersion(content: string): string {
  return parseUpdateManifest(content).version;
}

/**
 * Replaces updater checksums and sizes with metadata computed from the final local files.
 * This must run after signing/notarization, since those steps can change artifact bytes.
 */
export function refreshUpdateManifestMetadata(
  content: string,
  metadataByName: ReadonlyMap<string, ArtifactFileMetadata>
): string {
  const manifest = parseUpdateManifest(content);
  const metadataFor = (name: string): ArtifactFileMetadata => {
    if (basename(name) !== name) {
      throw new Error(`Update manifest references a non-local artifact ${name}`);
    }
    const metadata = metadataByName.get(name);
    if (!metadata) throw new Error(`No final artifact metadata exists for ${name}`);
    return metadata;
  };

  manifest.files = manifest.files.map((file) => {
    const metadata = metadataFor(file.url);
    return { ...file, sha512: metadata.sha512, size: metadata.size };
  });
  if (manifest.path) {
    manifest.sha512 = metadataFor(manifest.path).sha512;
  }
  return stringify(manifest, { lineWidth: 0 });
}

export function versionUpdateManifestUrls(
  content: string,
  versionPrefix: string,
  availableAssets: ReadonlySet<string>
): string {
  const manifest = parseUpdateManifest(content);
  const versionUrl = (name: string): string => {
    if (basename(name) !== name || !availableAssets.has(name)) {
      throw new Error(`Update manifest references unknown release asset ${name}`);
    }
    return `${versionPrefix}/${name}`;
  };

  manifest.files = manifest.files.map((file) => ({ ...file, url: versionUrl(file.url) }));
  if (manifest.path) manifest.path = versionUrl(manifest.path);
  return stringify(manifest, { lineWidth: 0 });
}

type PublishEntry = Record<string, unknown> | string;

/**
 * Derives the GitHub and R2 update channels from the electron-builder publish array.
 * - `githubChannel`: the `channel` field of the first `provider: 'github'` entry (default `'latest'`).
 * - `r2Channel`: the `channel` field of the first `provider: 'generic'` entry (`undefined` if absent).
 */
export function resolvePublishChannels(publish: PublishEntry[]): {
  githubChannel: string;
  r2Channel: string | undefined;
} {
  const entries = publish.filter((p): p is Record<string, unknown> => typeof p !== 'string');
  const github = entries.find((p) => p['provider'] === 'github');
  const generic = entries.find((p) => p['provider'] === 'generic');
  return {
    githubChannel: typeof github?.['channel'] === 'string' ? github['channel'] : 'latest',
    r2Channel: typeof generic?.['channel'] === 'string' ? generic['channel'] : undefined,
  };
}
