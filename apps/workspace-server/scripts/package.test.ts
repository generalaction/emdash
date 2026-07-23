import { describe, expect, it } from 'vitest';
import {
  artifactArchiveName,
  artifactChecksumContents,
  createDevPackageVersion,
  createArtifactManifest,
  createLauncher,
  nodeDistributionArchiveName,
  nodeDistributionUrl,
  parsePackageArgs,
  parsePackageTarget,
} from './package-helpers';

describe('workspace-server package helpers', () => {
  it('parses and deduplicates supported targets', () => {
    expect(
      parsePackageArgs([
        '--target',
        'linux-x64',
        '--target=darwin-arm64',
        '--target',
        'linux-x64',
        '--verify',
      ])
    ).toEqual({
      targets: [parsePackageTarget('linux-x64'), parsePackageTarget('darwin-arm64')],
      verify: true,
      help: false,
    });
  });

  it('rejects unsupported targets and missing target values', () => {
    expect(() => parsePackageTarget('win32-x64')).toThrow(/Unsupported target/);
    expect(() => parsePackageArgs(['--target'])).toThrow(/requires a value/);
    expect(() => parsePackageArgs(['--wat'])).toThrow(/Unknown packaging option/);
  });

  it('builds official Node distribution names and URLs', () => {
    const target = parsePackageTarget('linux-arm64');
    expect(nodeDistributionArchiveName('24.14.0', target)).toBe('node-v24.14.0-linux-arm64.tar.xz');
    expect(nodeDistributionUrl('24.14.0', target)).toBe(
      'https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-arm64.tar.xz'
    );
  });

  it('builds artifact metadata and archive names', () => {
    const target = parsePackageTarget('darwin-arm64');
    expect(
      createArtifactManifest({
        name: '@emdash/workspace-server',
        version: '0.1.0',
        protocolVersion: '5.0.0',
        nodeVersion: '24.14.0',
        target,
      })
    ).toEqual({
      name: '@emdash/workspace-server',
      version: '0.1.0',
      protocolVersion: '5.0.0',
      os: 'darwin',
      arch: 'arm64',
      nodeVersion: '24.14.0',
    });
    expect(artifactArchiveName('0.1.0', target)).toBe(
      'emdash-workspace-server-0.1.0-darwin-arm64.tar.gz'
    );
  });

  it('derives semver-compatible dev package versions', () => {
    expect(createDevPackageVersion('0.1.0', 'abc123')).toBe('0.1.0-dev.abc123');
    expect(createDevPackageVersion('0.1.0', '0.1.0-dev.manual')).toBe('0.1.0-dev.manual');
    expect(() => createDevPackageVersion('0.1.0', 'not valid')).toThrow(
      /Invalid workspace-server package version/
    );
  });

  it('formats sha256 sidecars for remote verification', () => {
    const checksum = 'a'.repeat(64);
    expect(artifactChecksumContents(checksum, 'server.tar.gz')).toBe(
      `${checksum}  server.tar.gz\n`
    );
    expect(() => artifactChecksumContents('not-a-checksum', 'server.tar.gz')).toThrow('sha256');
  });

  it('generates a relocatable launcher with a safely quoted app version', () => {
    const launcher = createLauncher("0.1.0-canary'1");
    expect(launcher).toContain('script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)');
    expect(launcher).toContain("export EMDASH_WS_APP_VERSION='0.1.0-canary'\\''1'");
    expect(launcher).toContain('exec "$root_dir/node" "$root_dir/dist/index.mjs" "$@"');
    expect(launcher.endsWith('\n')).toBe(true);
  });
});
