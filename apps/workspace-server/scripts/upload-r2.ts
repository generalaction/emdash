import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3mini } from 's3mini';
import { artifactArchiveName, parsePackageTarget, type PackageTarget } from './package-helpers';
import {
  artifactVersionFromArchiveName,
  contentTypeForObjectKey,
  expectedArtifactNames,
  immutableUploadDecision,
  installScriptObjectKey,
  latestVersionContents,
  latestVersionObjectKey,
  parseArtifactChecksum,
  releaseTargets,
  versionedArtifactObjectKey,
} from './upload-helpers';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const artifactsDirectory = join(appDirectory, 'dist-artifacts');

type UploadOptions = {
  version?: string;
  targets?: PackageTarget[];
};

type UploadConfig = {
  label: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
};

type ValidatedArtifact = {
  path: string;
  key: string;
  sha256: string;
};

async function main(): Promise<void> {
  const options = parseUploadArgs(process.argv.slice(2));
  const devUpload = process.env['EMDASH_WS_DEV_UPLOAD'] === '1';
  const targets = resolveUploadTargets(options, devUpload);
  const version =
    options.version ??
    (devUpload ? await resolveLatestDevArtifactVersion(targets) : await readPackageVersion());
  const artifacts = await validateArtifacts(
    version,
    targets,
    !devUpload && options.targets === undefined
  );
  const config = resolveUploadConfig();
  const s3 = new S3mini({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    endpoint: config.endpoint,
    region: 'auto',
  });

  for (const artifact of artifacts) {
    await uploadImmutableArtifact(s3, artifact);
  }

  await uploadMutableObject(
    s3,
    installScriptObjectKey,
    new Uint8Array(await readFile(join(appDirectory, 'install.sh')))
  );
  await uploadMutableObject(
    s3,
    latestVersionObjectKey,
    new TextEncoder().encode(latestVersionContents(version))
  );

  process.stdout.write(`Published workspace-server ${version} to ${config.label}\n`);
}

function parseUploadArgs(args: string[]): UploadOptions {
  const targets: PackageTarget[] = [];
  let version: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
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
    if (argument === '--version') {
      const value = args[index + 1];
      if (value === undefined) throw new Error('--version requires a value');
      version = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--version=')) {
      version = argument.slice('--version='.length);
      continue;
    }
    throw new Error(`Unknown upload option '${argument}'`);
  }

  return {
    version,
    targets:
      targets.length === 0
        ? undefined
        : targets.filter(
            (target, index) =>
              targets.findIndex((candidate) => candidate.id === target.id) === index
          ),
  };
}

function resolveUploadTargets(options: UploadOptions, devUpload: boolean): PackageTarget[] {
  if (options.targets !== undefined) return options.targets;
  if (devUpload) return [defaultDevUploadTarget()];
  return [...releaseTargets];
}

function defaultDevUploadTarget(): PackageTarget {
  const explicitTarget = process.env['EMDASH_WS_DEV_REMOTE_TARGET']?.trim();
  if (explicitTarget !== undefined && explicitTarget.length > 0) {
    return parsePackageTarget(explicitTarget);
  }
  return parsePackageTarget(process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64');
}

async function resolveLatestDevArtifactVersion(targets: readonly PackageTarget[]): Promise<string> {
  if (targets.length !== 1) {
    throw new Error('--version is required when uploading multiple targets');
  }

  const target = targets[0];
  if (target === undefined) throw new Error('At least one upload target is required');

  const entries = await readdir(artifactsDirectory, { withFileTypes: true });
  let latest: { archiveName: string; version: string; mtimeMs: number } | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.sha256')) continue;
    const version = artifactVersionFromArchiveName(entry.name, target);
    if (version === undefined) continue;
    const archivePath = join(artifactsDirectory, entry.name);
    const { mtimeMs } = await stat(archivePath);
    if (latest === undefined || mtimeMs > latest.mtimeMs) {
      latest = { archiveName: entry.name, version, mtimeMs };
    }
  }

  if (latest === undefined) {
    throw new Error(
      `No workspace-server ${target.id} artifact found under ${artifactsDirectory}; run pnpm run package --target ${target.id}`
    );
  }

  process.stdout.write(`Using ${latest.archiveName} for dev upload\n`);
  return latest.version;
}

async function validateArtifacts(
  version: string,
  targets: readonly PackageTarget[],
  requireExactArtifactSet: boolean
): Promise<ValidatedArtifact[]> {
  const expectedNames = expectedArtifactNames(version, targets);
  const expectedNameSet = new Set(expectedNames);
  const entries = await readdir(artifactsDirectory, { withFileTypes: true });
  const actualNames = entries
    .filter(
      (entry) =>
        entry.isFile() && (entry.name.endsWith('.tar.gz') || entry.name.endsWith('.tar.gz.sha256'))
    )
    .map((entry) => entry.name)
    .sort();
  const missingNames = expectedNames.filter((name) => !actualNames.includes(name));
  const unexpectedNames = requireExactArtifactSet
    ? actualNames.filter((name) => !expectedNameSet.has(name))
    : [];

  if (missingNames.length > 0 || unexpectedNames.length > 0) {
    const details = [
      missingNames.length === 0 ? undefined : `missing: ${missingNames.join(', ')}`,
      unexpectedNames.length === 0 ? undefined : `unexpected: ${unexpectedNames.join(', ')}`,
    ].filter((detail): detail is string => detail !== undefined);
    throw new Error(`Workspace-server release artifacts are incomplete (${details.join('; ')})`);
  }

  const validatedArtifacts: ValidatedArtifact[] = [];
  for (const target of targets) {
    const archiveName = artifactArchiveName(version, target);
    const archivePath = join(artifactsDirectory, archiveName);
    const sidecarName = `${archiveName}.sha256`;
    const sidecarPath = join(artifactsDirectory, sidecarName);
    const archiveSha256 = sha256(await readFile(archivePath));
    const declaredSha256 = parseArtifactChecksum(await readFile(sidecarPath, 'utf8'), archiveName);
    if (declaredSha256 !== archiveSha256) {
      throw new Error(
        `Checksum sidecar for ${archiveName} declares ${declaredSha256}, actual ${archiveSha256}`
      );
    }

    validatedArtifacts.push(
      {
        path: archivePath,
        key: versionedArtifactObjectKey(version, archiveName),
        sha256: archiveSha256,
      },
      {
        path: sidecarPath,
        key: versionedArtifactObjectKey(version, sidecarName),
        sha256: sha256(await readFile(sidecarPath)),
      }
    );
  }
  return validatedArtifacts;
}

async function uploadImmutableArtifact(s3: S3mini, artifact: ValidatedArtifact): Promise<void> {
  const remoteData = await s3.getObjectArrayBuffer(artifact.key);
  const decision = immutableUploadDecision(
    artifact.sha256,
    remoteData === null ? undefined : sha256(new Uint8Array(remoteData))
  );
  if (decision === 'skip') {
    process.stdout.write(`Skipping unchanged immutable object ${artifact.key}\n`);
    return;
  }

  const localData = new Uint8Array(await readFile(artifact.path));
  const currentSha256 = sha256(localData);
  if (currentSha256 !== artifact.sha256) {
    throw new Error(`Artifact changed after validation: ${artifact.path}`);
  }

  process.stdout.write(`Uploading ${artifact.key}\n`);
  const response = await s3.putAnyObject(
    artifact.key,
    localData,
    contentTypeForObjectKey(artifact.key)
  );
  if (!response.ok) {
    throw new Error(`Upload failed for ${artifact.key} with HTTP ${response.status}`);
  }
}

async function uploadMutableObject(s3: S3mini, key: string, data: Uint8Array): Promise<void> {
  const remoteData = await s3.getObjectArrayBuffer(key);
  if (remoteData !== null && sha256(new Uint8Array(remoteData)) === sha256(data)) {
    process.stdout.write(`Skipping unchanged object ${key}\n`);
    return;
  }

  process.stdout.write(`Uploading ${key}\n`);
  const response = await s3.putObject(key, data, contentTypeForObjectKey(key));
  if (!response.ok) {
    throw new Error(`Upload failed for ${key} with HTTP ${response.status}`);
  }
}

async function readPackageVersion(): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(join(appDirectory, 'package.json'), 'utf8'));
  if (!isRecord(raw) || typeof raw['version'] !== 'string') {
    throw new Error('workspace-server package.json must contain a string version');
  }
  return raw['version'];
}

function resolveUploadConfig(): UploadConfig {
  const endpoint = process.env['EMDASH_WS_UPLOAD_ENDPOINT'];
  if (endpoint !== undefined && endpoint.length > 0) {
    return {
      label: endpoint,
      accessKeyId: requireEnv('EMDASH_WS_UPLOAD_ACCESS_KEY'),
      secretAccessKey: requireEnv('EMDASH_WS_UPLOAD_SECRET_KEY'),
      endpoint,
    };
  }
  return {
    label: 'R2',
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${requireEnv(
      'R2_BUCKET'
    )}`,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `workspace-server upload failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
