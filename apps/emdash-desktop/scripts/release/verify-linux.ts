import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
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
const useLegacyMode = [archInput, targetsInput, prefix, executable].every(
  (value) => value === undefined
);

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
  return nativeModules.length;
}

interface GlibcInspection {
  file: string;
  symbols: string[];
  error?: string;
}

function inspectGlibcSymbols(file: string): GlibcInspection {
  try {
    const output = command('objdump', ['-T', file]);
    return {
      file,
      symbols: Array.from(output.matchAll(/GLIBC_(\d+\.\d+)/g), (match) => match[1]),
    };
  } catch (error) {
    return {
      file,
      symbols: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyLegacyNativeModules(): void {
  const nativeModules = findFiles(RELEASE_DIR, (file) => {
    const normalized = file.replaceAll('\\', '/');
    return (
      file.endsWith('.node') && !normalized.includes('/darwin-') && !normalized.includes('/win32-')
    );
  });
  if (nativeModules.length === 0) {
    fail(`Cannot verify Linux native modules because no .node files were found in ${RELEASE_DIR}/`);
  }

  const violations: GlibcSymbol[] = [];
  const inspectionFailures: GlibcInspection[] = [];
  let inspected = 0;
  for (const file of nativeModules) {
    const inspection = inspectGlibcSymbols(file);
    if (inspection.error) {
      inspectionFailures.push(inspection);
      continue;
    }
    if (inspection.symbols.length === 0) continue;

    inspected += 1;
    for (const version of new Set(inspection.symbols)) {
      if (isGreaterVersion(version, maxGlibc)) violations.push({ file, version });
    }
  }

  if (inspectionFailures.length > 0) {
    const details = inspectionFailures.map(({ file, error }) => `  ${file}: ${error}`).join('\n');
    fail(`Cannot verify Linux native modules because objdump failed for:\n${details}`);
  }
  if (inspected === 0) {
    fail('Cannot verify Linux native modules because objdump found no GLIBC symbols');
  }
  if (violations.length > 0) {
    const details = violations.map(({ file, version }) => `  ${file}: GLIBC_${version}`).join('\n');
    fail(`Linux native modules require GLIBC newer than ${maxGlibc}:\n${details}`);
  }
  info(`Verified ${inspected} Linux native module(s) against GLIBC <= ${maxGlibc}`);
}

if (!existsSync(RELEASE_DIR)) {
  if (useLegacyMode) {
    fail(`Cannot verify Linux native modules because ${RELEASE_DIR}/ does not exist`);
  }
  fail(`Cannot verify Linux packages because ${RELEASE_DIR}/ does not exist`);
}

if (useLegacyMode) {
  verifyLegacyNativeModules();
} else {
  if (!archInput || !isLinuxArch(archInput) || !targetsInput || !prefix || !executable) {
    fail(
      'Usage: verify-linux.ts --arch arm64|x64 --targets AppImage,deb,rpm ' +
        '--prefix <artifact-prefix> --executable <name>'
    );
  }
  const targets = parseLinuxTargets(targetsInput);
  if (!targets) fail(`Unsupported Linux targets: ${targetsInput}`);

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
      inspectedNativeModules += verifyExtractedPayload(payload, target, archInput, executable);
    }
  } finally {
    rmSync(verificationDir, { recursive: true, force: true });
  }

  info(
    `Extracted and verified ${archInput} ${targets.join(', ')} payloads, including ` +
      `${inspectedNativeModules} native module instance(s) against GLIBC <= ${maxGlibc}`
  );
}
