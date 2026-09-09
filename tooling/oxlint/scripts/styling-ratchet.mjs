import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MANIFEST_DIR,
  DEFAULT_REGISTRY_DIR,
  DEFAULT_REPO_ROOT,
  normalizePath,
  STYLING_RULE_NAMES,
} from '../rules/styling-rule-utils.js';

const MARKER_PATTERN = /\[emdash-styling:([^\]]+)\]/;

export function collectStylingViolations(diagnostics) {
  const violations = Object.fromEntries(
    STYLING_RULE_NAMES.map((ruleName) => [ruleName, new Set()])
  );
  for (const diagnostic of diagnostics) {
    const match = /^emdash\(([^)]+)\)$/.exec(diagnostic.code ?? '');
    const ruleName = match?.[1];
    if (!ruleName || !violations[ruleName]) continue;
    const marker = MARKER_PATTERN.exec(diagnostic.message ?? '')?.[1];
    if (!marker) continue;
    const filename = normalizePath(diagnostic.filename ?? '').replace(/^\.\//, '');
    violations[ruleName].add(`${filename}::${marker}`);
  }
  return violations;
}

export function findStaleStylingEntries(manifest, violations) {
  const entries = [
    ...(Array.isArray(manifest.violations) ? manifest.violations : []),
    ...(Array.isArray(manifest.exceptions)
      ? manifest.exceptions.map((entry) => entry?.id).filter(Boolean)
      : []),
  ];
  return entries.filter((entry) => !violations.has(entry)).sort(compareText);
}

export function validateStylingManifest(ruleName, manifest, repoRoot = DEFAULT_REPO_ROOT) {
  const errors = [];
  const violations = Array.isArray(manifest.violations) ? manifest.violations : [];
  const sortedViolations = [...violations].sort(compareText);
  if (!arraysEqual(violations, sortedViolations)) errors.push('violations must be sorted');
  for (const duplicate of duplicates(violations)) {
    errors.push(`violations contains duplicate id: ${duplicate}`);
  }

  const exceptions = Array.isArray(manifest.exceptions) ? manifest.exceptions : [];
  const exceptionIds = exceptions.map((entry) => entry?.id).filter(Boolean);
  if (!arraysEqual(exceptionIds, [...exceptionIds].sort(compareText))) {
    errors.push('exceptions must be sorted');
  }
  for (const duplicate of duplicates(exceptionIds)) {
    errors.push(`exceptions contains duplicate id: ${duplicate}`);
  }

  const focusedPrefix = normalizePath(`tooling/oxlint/fixtures/permanent-exceptions/${ruleName}/`);
  for (const exception of exceptions) {
    const id = exception?.id ?? '<missing-id>';
    if (
      typeof exception?.reason !== 'string' ||
      !exception.reason.startsWith('External constraint: ') ||
      exception.reason.length <= 'External constraint: '.length
    ) {
      errors.push(`exception ${id} needs an external-constraint reason`);
    }
    const fixture = typeof exception?.fixture === 'string' ? normalizePath(exception.fixture) : '';
    if (!fixture.startsWith(focusedPrefix)) {
      errors.push(`exception ${id} needs a fixture under ${focusedPrefix}`);
    } else if (!fs.existsSync(path.resolve(repoRoot, fixture))) {
      errors.push(`exception ${id} fixture does not exist: ${fixture}`);
    }
  }

  return errors;
}

export function listStylingManifestFiles(manifestDir = DEFAULT_MANIFEST_DIR) {
  return STYLING_RULE_NAMES.map((ruleName) => ({
    ruleName,
    path: path.join(manifestDir, `${ruleName}.json`),
  })).filter(({ path: manifestPath }) => fs.existsSync(manifestPath));
}

export function listStylingRegistryFiles(registryDir = DEFAULT_REGISTRY_DIR) {
  return ['global-adapters', 'host-adapters', 'styling-infrastructure'].map((registryName) => ({
    registryName,
    path: path.join(registryDir, `${registryName}.json`),
  }));
}

export function validateStylingRegistry(_registryName, registry, repoRoot = DEFAULT_REPO_ROOT) {
  const errors = [];
  const modules = Array.isArray(registry.modules) ? registry.modules : [];
  if (!arraysEqual(modules, [...modules].sort(compareText))) errors.push('modules must be sorted');
  for (const duplicate of duplicates(modules)) {
    errors.push(`modules contains duplicate path: ${duplicate}`);
  }
  for (const modulePath of modules) {
    const normalized = normalizePath(modulePath);
    if (path.isAbsolute(modulePath) || normalized.startsWith('../')) {
      errors.push(`registered module must be repo-relative: ${modulePath}`);
      continue;
    }
    if (!fs.existsSync(path.resolve(repoRoot, normalized))) {
      errors.push(`registered module does not exist: ${modulePath}`);
    }
  }
  return errors;
}

export function collectStylingViolationsFromOxlint(repoRoot = DEFAULT_REPO_ROOT) {
  const result = spawnSync('pnpm', ['exec', 'oxlint', '--format', 'json', '--quiet', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, EMDASH_DISABLE_STYLING_ALLOWLISTS: '1' },
  });
  if (result.error) throw result.error;

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Failed to parse oxlint JSON output (exit ${result.status}).\n${result.stderr ?? ''}`
    );
  }
  return collectStylingViolations(parsed.diagnostics ?? []);
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].sort(compareText);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
