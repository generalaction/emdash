import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findUndeclaredLibraries, parseNeededLibraries } from './lib/linux-dependencies.ts';
import type { LinuxPackageFormat } from './lib/linux-dependencies.ts';
import {
  isLinuxArch,
  linuxArtifactName,
  linuxPackageArch,
  objdumpArch,
  objdumpMatchesArch,
  parseLinuxTargets,
  selectLinuxNativeModules,
} from './lib/linux-release.ts';
import type { LinuxArch, LinuxTarget } from './lib/linux-release.ts';
import { fail, info } from './lib/log.ts';

const DEFAULT_MAX_GLIBC = '2.35';
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const RELEASE_DIR = 'release';
const maxGlibc = process.env.EMDASH_MAX_GLIBC ?? DEFAULT_MAX_GLIBC;

const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
    targets: { type: 'string' },
    prefix: { type: 'string' },
    executable: { type: 'string' },
  },
  strict: true,
});

const archInput = values.arch;
const targetsInput = values.targets;
const prefix = values.prefix;
const executable = values.executable;

interface GlibcSymbol {
  file: string;
  version: string;
}

function parseVersion(version: string): [number, number] {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (!match) fail(`Invalid GLIBC version: ${version}`);
  return [Number(match[1]), Number(match[2])];
}

function isGreaterVersion(actual: string, max: string): boolean {
  const [actualMajor, actualMinor] = parseVersion(actual);
  const [maxMajor, maxMinor] = parseVersion(max);
  return actualMajor > maxMajor || (actualMajor === maxMajor && actualMinor > maxMinor);
}

function findFiles(dir: string, predicate: (file: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(fullPath, predicate));
    else if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

function command(commandName: string, args: string[]): string {
  return execFileSync(commandName, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function verifyBinaryArch(file: string, arch: LinuxArch): void {
  const output = command('objdump', ['-f', file]);
  if (!objdumpMatchesArch(output, arch)) {
    fail(`Expected ${file} to be ${objdumpArch(arch)}, but objdump reported:\n${output}`);
  }
}

function verifyPackageMetadata(file: string, target: LinuxTarget, arch: LinuxArch): void {
  if (target === 'deb') {
    const actual = command('dpkg-deb', ['-f', file, 'Architecture']);
    const expected = linuxPackageArch(arch, target);
    if (actual !== expected) fail(`Expected ${file} architecture ${expected}, got ${actual}`);
  }
  if (target === 'rpm') {
    const actual = command('rpm', ['-qp', '--queryformat', '%{ARCH}', file]);
    const expected = linuxPackageArch(arch, target);
    if (actual !== expected) fail(`Expected ${file} architecture ${expected}, got ${actual}`);
  }
}

function isElfFile(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const magic = Buffer.alloc(ELF_MAGIC.length);
    return readSync(fd, magic, 0, magic.length, 0) === magic.length && magic.equals(ELF_MAGIC);
  } finally {
    closeSync(fd);
  }
}

function declaredDependencies(artifact: string, format: LinuxPackageFormat): Set<string> {
  const dependencies =
    format === 'deb'
      ? command('dpkg-deb', ['-f', artifact, 'Depends']).split(',')
      : command('rpm', ['-qp', '--requires', artifact]).split('\n');
  return new Set(dependencies.map((dependency) => dependency.trim()));
}

/**
 * Checks that the package declares a dependency for every system library its Electron binaries
 * and runtime native modules link against. Otherwise the package manager installs it on a minimal
 * system and the executable fails to start with "cannot open shared object file".
 */
function verifyDeclaredLibraries(
  artifact: string,
  format: LinuxPackageFormat,
  root: string,
  executableFile: string,
  nativeModules: readonly string[]
): void {
  const appDir = path.dirname(executableFile);
  const appBinaries = readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(appDir, entry.name))
    .filter(isElfFile);
  const neededByFile = new Map(
    [...appBinaries, ...nativeModules].map((file) => [
      path.relative(root, file),
      parseNeededLibraries(command('objdump', ['-p', file])),
    ])
  );
  const bundledLibraries = new Set(appBinaries.map((file) => path.basename(file)));
  const undeclared = findUndeclaredLibraries(
    format,
    neededByFile,
    bundledLibraries,
    declaredDependencies(artifact, format)
  );
  if (undeclared.length > 0) {
    const details = undeclared
      .map(({ library, neededBy, dependency }) => {
        const fix =
          dependency === undefined
            ? 'add it to SYSTEM_LIBRARIES in lib/linux-dependencies.ts'
            : `${format} must depend on "${dependency}"`;
        return `  ${library}: ${fix} (needed by ${neededBy.join(', ')})`;
      })
      .join('\n');
    fail(`${artifact} does not declare dependencies for linked system libraries:\n${details}`);
  }
}

function extractPackage(artifact: string, target: LinuxTarget, destination: string): string {
  const absoluteArtifact = path.resolve(artifact);
  mkdirSync(destination, { recursive: true });
  if (target === 'AppImage') {
    execFileSync(absoluteArtifact, ['--appimage-extract'], {
      cwd: destination,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return path.join(destination, 'squashfs-root');
  }
  if (target === 'deb') {
    execFileSync('dpkg-deb', ['-x', absoluteArtifact, destination], { stdio: 'pipe' });
    return destination;
  }

  const cpioArchive = path.join(destination, 'payload.cpio');
  const outputFd = openSync(cpioArchive, 'w');
  try {
    execFileSync('rpm2cpio', [absoluteArtifact], {
      stdio: ['ignore', outputFd, 'pipe'],
    });
  } finally {
    closeSync(outputFd);
  }
  const inputFd = openSync(cpioArchive, 'r');
  try {
    execFileSync('cpio', ['-idm', '--quiet'], {
      cwd: destination,
      stdio: [inputFd, 'ignore', 'pipe'],
    });
  } finally {
    closeSync(inputFd);
    rmSync(cpioArchive, { force: true });
  }
  return destination;
}

function verifyExtractedPayload(
  artifact: string,
  root: string,
  target: LinuxTarget,
  arch: LinuxArch,
  executable: string
): number {
  const executables = findFiles(root, (file) => path.basename(file) === executable);
  if (executables.length !== 1) {
    fail(`Expected one executable named "${executable}" in ${target}, found ${executables.length}`);
  }
  verifyBinaryArch(executables[0], arch);

  const packagedNativeModules = findFiles(root, (file) => file.endsWith('.node'));
  const nativeModuleSelection = selectLinuxNativeModules(packagedNativeModules, arch);
  if (nativeModuleSelection.missing.length > 0) {
    const missing = nativeModuleSelection.missing
      .map(({ moduleName, pathSuffix }) => `${moduleName} (${pathSuffix})`)
      .join(', ');
    fail(`${target} payload is missing required Linux native modules: ${missing}`);
  }
  if (nativeModuleSelection.duplicates.length > 0) {
    const duplicates = nativeModuleSelection.duplicates
      .map(({ moduleName, files }) => `${moduleName}: ${files.join(', ')}`)
      .join('\n');
    fail(`${target} payload contains duplicate active Linux native modules:\n${duplicates}`);
  }
  const nativeModules = nativeModuleSelection.selected;

  const violations: GlibcSymbol[] = [];
  let glibcInspected = 0;
  for (const file of nativeModules) {
    verifyBinaryArch(file, arch);
    const output = command('objdump', ['-T', file]);
    const symbols = Array.from(output.matchAll(/GLIBC_(\d+\.\d+)/g), (match) => match[1]);
    if (symbols.length > 0) glibcInspected += 1;
    for (const version of new Set(symbols)) {
      if (isGreaterVersion(version, maxGlibc)) violations.push({ file, version });
    }
  }

  if (glibcInspected === 0) {
    fail(`${target} payload has no native modules with inspectable GLIBC symbols`);
  }
  if (violations.length > 0) {
    const details = violations.map(({ file, version }) => `  ${file}: GLIBC_${version}`).join('\n');
    fail(`${target} native modules require GLIBC newer than ${maxGlibc}:\n${details}`);
  }
  if (target !== 'AppImage') {
    verifyDeclaredLibraries(artifact, target, root, executables[0], nativeModules);
  }
  return nativeModules.length;
}

if (!archInput || !isLinuxArch(archInput) || !targetsInput || !prefix || !executable) {
  fail(
    'Usage: verify-linux.ts --arch arm64|x64 --targets AppImage,deb,rpm ' +
      '--prefix <artifact-prefix> --executable <name>'
  );
}
const targets = parseLinuxTargets(targetsInput);
if (!targets) fail(`Unsupported Linux targets: ${targetsInput}`);
if (!existsSync(RELEASE_DIR)) {
  fail(`Cannot verify Linux packages because ${RELEASE_DIR}/ does not exist`);
}

const verificationDir = mkdtempSync(path.join(tmpdir(), `emdash-linux-${archInput}-`));
let inspectedNativeModules = 0;
try {
  for (const target of targets) {
    const artifact = path.join(RELEASE_DIR, linuxArtifactName(prefix, archInput, target));
    if (!existsSync(artifact)) fail(`Expected Linux release artifact is missing: ${artifact}`);
    verifyPackageMetadata(artifact, target, archInput);
    if (target === 'AppImage') verifyBinaryArch(artifact, archInput);

    const destination = path.join(verificationDir, target.toLowerCase());
    const payload = extractPackage(artifact, target, destination);
    inspectedNativeModules += verifyExtractedPayload(
      artifact,
      payload,
      target,
      archInput,
      executable
    );
  }
} finally {
  rmSync(verificationDir, { recursive: true, force: true });
}

info(
  `Extracted and verified ${archInput} ${targets.join(', ')} payloads, including ` +
    `${inspectedNativeModules} native module instance(s) against GLIBC <= ${maxGlibc}`
);
