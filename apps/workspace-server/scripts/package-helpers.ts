export const artifactRootName = 'emdash-workspace-server';

const targetDefinitions = {
  'darwin-arm64': {
    id: 'darwin-arm64',
    os: 'darwin',
    arch: 'arm64',
    dockerPlatform: undefined,
  },
  'linux-arm64': {
    id: 'linux-arm64',
    os: 'linux',
    arch: 'arm64',
    dockerPlatform: 'linux/arm64',
  },
  'linux-x64': {
    id: 'linux-x64',
    os: 'linux',
    arch: 'x64',
    dockerPlatform: 'linux/amd64',
  },
} as const;

export type PackageTargetId = keyof typeof targetDefinitions;
export type PackageTarget = (typeof targetDefinitions)[PackageTargetId];

export type PackageCliOptions = {
  targets: PackageTarget[];
  verify: boolean;
  help: boolean;
};

export type WorkspaceServerArtifactManifest = {
  name: string;
  version: string;
  protocolVersion: string;
  os: PackageTarget['os'];
  arch: PackageTarget['arch'];
  nodeVersion: string;
};

export function parsePackageTarget(value: string): PackageTarget {
  if (value in targetDefinitions) {
    return targetDefinitions[value as PackageTargetId];
  }
  throw new Error(
    `Unsupported target '${value}'. Expected one of: ${Object.keys(targetDefinitions).join(', ')}`
  );
}

export function parsePackageArgs(args: string[]): PackageCliOptions {
  const targets: PackageTarget[] = [];
  let verify = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--verify') {
      verify = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--target') {
      const value = args[index + 1];
      if (value === undefined) throw new Error('--target requires a value');
      targets.push(parsePackageTarget(value));
      index += 1;
      continue;
    }
    if (argument.startsWith('--target=')) {
      targets.push(parsePackageTarget(argument.slice('--target='.length)));
      continue;
    }
    throw new Error(`Unknown packaging option '${argument}'`);
  }

  return {
    targets: targets.filter(
      (target, index) => targets.findIndex((candidate) => candidate.id === target.id) === index
    ),
    verify,
    help,
  };
}

export function nodeDistributionArchiveName(nodeVersion: string, target: PackageTarget): string {
  return `node-v${nodeVersion}-${target.os}-${target.arch}.tar.xz`;
}

export function nodeDistributionUrl(nodeVersion: string, target: PackageTarget): string {
  return `https://nodejs.org/dist/v${nodeVersion}/${nodeDistributionArchiveName(
    nodeVersion,
    target
  )}`;
}

export function artifactArchiveName(version: string, target: PackageTarget): string {
  return `${artifactRootName}-${version}-${target.os}-${target.arch}.tar.gz`;
}

export function artifactChecksumContents(checksum: string, archiveName: string): string {
  if (!/^[a-f\d]{64}$/.test(checksum)) throw new Error('Artifact checksum must be sha256 hex');
  if (archiveName.length === 0 || /[\s/\\]/.test(archiveName)) {
    throw new Error('Artifact archive name must be a single non-empty path component');
  }
  return `${checksum}  ${archiveName}\n`;
}

export function createArtifactManifest(options: {
  name: string;
  version: string;
  protocolVersion: string;
  nodeVersion: string;
  target: PackageTarget;
}): WorkspaceServerArtifactManifest {
  return {
    name: options.name,
    version: options.version,
    protocolVersion: options.protocolVersion,
    os: options.target.os,
    arch: options.target.arch,
    nodeVersion: options.nodeVersion,
  };
}

export function createLauncher(version: string): string {
  return `#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

export EMDASH_WS_APP_VERSION=${quoteShellArgument(version)}
exec "$root_dir/node" "$root_dir/dist/index.mjs" "$@"
`;
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
