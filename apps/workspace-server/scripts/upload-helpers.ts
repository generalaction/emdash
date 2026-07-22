import { artifactArchiveName, parsePackageTarget, type PackageTarget } from './package-helpers';

export const workspaceServerObjectPrefix = 'workspace-server';
export const installScriptObjectKey = `${workspaceServerObjectPrefix}/install.sh`;
export const latestVersionObjectKey = `${workspaceServerObjectPrefix}/latest.txt`;

const releaseVersionPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const sha256Pattern = /^[a-f\d]{64}$/;

export const releaseTargets: readonly PackageTarget[] = [
  parsePackageTarget('linux-x64'),
  parsePackageTarget('linux-arm64'),
  parsePackageTarget('darwin-arm64'),
];

export type ImmutableUploadDecision = 'skip' | 'upload';

export function expectedArtifactNames(version: string): string[] {
  validateReleaseVersion(version);
  return releaseTargets.flatMap((target) => {
    const archiveName = artifactArchiveName(version, target);
    return [archiveName, `${archiveName}.sha256`];
  });
}

export function versionedArtifactObjectKey(version: string, artifactName: string): string {
  validateReleaseVersion(version);
  if (artifactName.length === 0 || /[/\\]/.test(artifactName)) {
    throw new Error('Artifact name must be a single non-empty path component');
  }
  return `${workspaceServerObjectPrefix}/${version}/${artifactName}`;
}

export function latestVersionContents(version: string): string {
  validateReleaseVersion(version);
  return `${version}\n`;
}

export function contentTypeForObjectKey(key: string): string {
  if (key.endsWith('.sh')) return 'text/x-shellscript';
  if (key.endsWith('.txt') || key.endsWith('.sha256')) return 'text/plain';
  return 'application/octet-stream';
}

export function parseArtifactChecksum(contents: string, expectedArchiveName: string): string {
  const match = /^([a-fA-F\d]{64})  \*?([^\s]+)\r?\n?$/.exec(contents);
  if (match === null || match[1] === undefined || match[2] !== expectedArchiveName) {
    throw new Error(`Invalid checksum sidecar for ${expectedArchiveName}`);
  }
  return match[1].toLowerCase();
}

export function immutableUploadDecision(
  localSha256: string,
  remoteSha256?: string
): ImmutableUploadDecision {
  validateSha256(localSha256);
  if (remoteSha256 === undefined) return 'upload';
  validateSha256(remoteSha256);
  if (remoteSha256 === localSha256) return 'skip';
  throw new Error(
    `Refusing to replace immutable object: local sha256 ${localSha256}, remote sha256 ${remoteSha256}`
  );
}

export function validateReleaseVersion(version: string): void {
  if (!releaseVersionPattern.test(version)) {
    throw new Error(`Invalid workspace-server release version '${version}'`);
  }
}

function validateSha256(checksum: string): void {
  if (!sha256Pattern.test(checksum)) {
    throw new Error(`Invalid sha256 checksum '${checksum}'`);
  }
}
