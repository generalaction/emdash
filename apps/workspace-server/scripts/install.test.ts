import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installScript = resolve(appDirectory, 'install.sh');

describe('workspace-server install.sh', () => {
  it('is valid POSIX shell syntax', () => {
    const result = spawnSync('sh', ['-n', installScript]);

    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe('');
  });

  it('rejects unknown options with an install failure', () => {
    const result = spawnSync('sh', [installScript, '--unknown']);

    expect(result.status).toBe(42);
    expect(result.stderr.toString()).toContain("unknown option '--unknown'");
  });

  it('rejects unsupported base URL protocols before probing the host', () => {
    const result = spawnSync('sh', [installScript, '--base-url', 'ftp://example.test']);

    expect(result.status).toBe(41);
    expect(result.stderr.toString()).toContain('base URL must use https, http, or file');
  });

  it('requires an explicit immutable version', () => {
    const result = spawnSync('sh', [installScript]);

    expect(result.status).toBe(42);
    expect(result.stderr.toString()).toContain('--version is required');
  });

  it('installs a pinned version atomically and skips the artifact on a repeated run', async () => {
    const fixture = await createFixture({ os: 'Linux', machine: 'x86_64' });

    try {
      const first = spawnSync('sh', fixture.args, { env: fixture.env });
      expect(first.status, first.stderr.toString()).toBe(0);
      expect(await readlink(resolve(fixture.home, '.agent/workspace-server/current'))).toBe(
        `versions/${fixture.version}`
      );
      expect(await readLog(fixture.logs.tar)).toContain('--warning=no-unknown-keyword');
      expect(await readLog(fixture.logs.checksum)).toEqual(['sha256sum -c -']);

      const second = spawnSync('sh', fixture.args, { env: fixture.env });
      expect(second.status, second.stderr.toString()).toBe(0);
      expect(await readLog(fixture.logs.curl)).toHaveLength(3);
    } finally {
      await fixture.cleanup();
    }
  });

  it('installs on Apple silicon macOS with BSD userland and replaces current atomically', async () => {
    const fixture = await createFixture({ os: 'Darwin', machine: 'arm64' });
    const root = resolve(fixture.home, '.agent/workspace-server');
    const previousVersion = '1.0.0';
    await mkdir(resolve(root, 'versions', previousVersion, 'bin'), { recursive: true });
    await writeExecutable(
      resolve(root, 'versions', previousVersion, 'bin/agent-workspace-server'),
      'exit 0'
    );
    await symlink(`versions/${previousVersion}`, resolve(root, 'current'));

    try {
      const first = spawnSync('sh', fixture.args, { env: fixture.env });
      expect(first.status, first.stderr.toString()).toBe(0);
      expect(await readlink(resolve(root, 'current'))).toBe(`versions/${fixture.version}`);
      expect(await readLog(fixture.logs.tar)).not.toContain('--warning=no-unknown-keyword');
      expect(await readLog(fixture.logs.checksum)).toEqual(['shasum -a 256 -c -']);
      expect(await readLog(fixture.logs.node)).toEqual(['--input-type=module', '-e']);
      expect(await readLog(fixture.logs.mv)).not.toContainEqual(expect.stringContaining('-T'));

      const second = spawnSync('sh', fixture.args, { env: fixture.env });
      expect(second.status, second.stderr.toString()).toBe(0);
      expect(await readLog(fixture.logs.curl)).toHaveLength(3);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects Intel macOS because no artifact is published for it', async () => {
    const fixture = await createFixture({ os: 'Darwin', machine: 'x86_64' });

    try {
      const result = spawnSync('sh', fixture.args, { env: fixture.env });
      expect(result.status).toBe(40);
      expect(result.stderr.toString()).toContain('only published for Apple silicon');
      expect(await readLog(fixture.logs.curl)).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});

type FixtureOptions = {
  os: 'Linux' | 'Darwin';
  machine: 'x86_64' | 'arm64';
};

/**
 * Builds a fake release mirror plus a `bin/` directory of mocked host tools.
 * Linux fixtures mimic GNU coreutils and GNU tar; Darwin fixtures mimic the
 * BSD userland macOS ships (no `sha256sum`, `shasum` instead, a `tar` that
 * rejects `--warning`, and an `mv` without `-T`).
 */
async function createFixture(options: FixtureOptions) {
  const directory = await mkdtemp(resolve(tmpdir(), 'agent-install-script-'));
  const source = resolve(directory, 'source');
  const home = resolve(directory, 'home');
  const bin = resolve(directory, 'bin');
  const logs = {
    curl: resolve(directory, 'curl.log'),
    checksum: resolve(directory, 'checksum.log'),
    tar: resolve(directory, 'tar.log'),
    mv: resolve(directory, 'mv.log'),
    node: resolve(directory, 'node.log'),
  };
  const version = '1.2.3';
  const isDarwin = options.os === 'Darwin';
  const artifactOs = isDarwin ? 'darwin' : 'linux';
  const artifactArch = options.machine === 'x86_64' ? 'x64' : 'arm64';
  const artifact = `agent-workspace-server-${version}-${artifactOs}-${artifactArch}.tar.gz`;
  await Promise.all([
    mkdir(resolve(source, version), { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(source, version, artifact), 'fixture archive'),
    writeFile(resolve(source, version, `${artifact}.sha256`), `${'a'.repeat(64)}  ${artifact}\n`),
    writeExecutable(
      resolve(bin, 'uname'),
      `case "$1" in -s) printf '${options.os}\\n' ;; -m) printf '${options.machine}\\n' ;; esac`
    ),
    isDarwin
      ? writeExecutable(
          resolve(bin, 'getconf'),
          `echo 'getconf: no such configuration parameter' >&2; exit 1`
        )
      : writeExecutable(resolve(bin, 'getconf'), `printf 'glibc 2.36\\n'`),
    writeExecutable(
      resolve(bin, 'curl'),
      `output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --) shift; url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$CURL_LOG"
cp "\${url#file://}" "$output"`
    ),
    isDarwin
      ? writeExecutable(
          resolve(bin, 'sha256sum'),
          `echo 'sh: sha256sum: command not found' >&2; exit 127`
        )
      : writeExecutable(
          resolve(bin, 'sha256sum'),
          `printf 'sha256sum %s\\n' "$*" >> "$CHECKSUM_LOG"; cat >/dev/null`
        ),
    isDarwin
      ? writeExecutable(
          resolve(bin, 'shasum'),
          `printf 'shasum %s\\n' "$*" >> "$CHECKSUM_LOG"; cat >/dev/null`
        )
      : writeExecutable(
          resolve(bin, 'shasum'),
          `echo 'sh: shasum: command not found' >&2; exit 127`
        ),
    writeExecutable(
      resolve(bin, 'tar'),
      `destination=
for argument in "$@"; do
  printf '%s\\n' "$argument" >> "$TAR_LOG"
done
while [ "$#" -gt 0 ]; do
  case "$1" in
    --warning=*) ${isDarwin ? `echo 'tar: Option --warning is not supported' >&2; exit 1` : 'shift'} ;;
    --directory) destination=$2; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$destination/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$destination/bin/agent-workspace-server"
chmod +x "$destination/bin/agent-workspace-server"
cat > "$destination/node" <<'NODE'
#!/bin/sh
set -eu
printf '%s\\n' "$1" "$2" >> "$NODE_LOG"
exec "$TEST_NODE" "$@"
NODE
chmod +x "$destination/node"`
    ),
    writeExecutable(
      resolve(bin, 'mv'),
      `printf '%s\\n' "$*" >> "$MV_LOG"
if [ "\${1-}" = "-Tf" ]; then
  ${
    isDarwin
      ? `echo 'mv: illegal option -- T' >&2; exit 64`
      : `shift
  if [ "\${1-}" = "--" ]; then shift; fi
  source=$1
  destination=$2
  rm -f -- "$destination"
  /bin/mv "$source" "$destination"`
  }
elif [ "\${1-}" = "--" ]; then
  /bin/mv "$2" "$3"
else
  /bin/mv "$@"
fi`
    ),
  ]);
  const env = {
    ...process.env,
    CURL_LOG: logs.curl,
    CHECKSUM_LOG: logs.checksum,
    TAR_LOG: logs.tar,
    MV_LOG: logs.mv,
    NODE_LOG: logs.node,
    TEST_NODE: process.execPath,
    HOME: home,
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
  };
  const baseUrl = pathToFileURL(source).href;
  return {
    version,
    home,
    logs,
    env,
    args: [installScript, '--base-url', baseUrl, '--version', version],
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function readLog(path: string): Promise<string[]> {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line !== '');
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`);
  await chmod(path, 0o755);
}
