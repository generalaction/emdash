import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_REPO_ROOT } from '../rules/styling-rule-utils.js';
import {
  collectStylingViolationsFromOxlint,
  findStaleStylingEntries,
  listStylingManifestFiles,
  listStylingRegistryFiles,
  validateStylingManifest,
  validateStylingRegistry,
} from './styling-ratchet.mjs';

const violationsByRule = collectStylingViolationsFromOxlint();
let failureCount = 0;

for (const { ruleName, path: manifestPath } of listStylingManifestFiles()) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failureCount += 1;
    console.error(
      error?.code === 'ENOENT'
        ? `missing styling manifest: ${path.relative(DEFAULT_REPO_ROOT, manifestPath)}`
        : `invalid styling manifest ${path.relative(DEFAULT_REPO_ROOT, manifestPath)}: ${error}`
    );
    continue;
  }

  for (const error of validateStylingManifest(ruleName, manifest)) {
    failureCount += 1;
    console.error(`invalid styling manifest ${ruleName}: ${error}`);
  }
  for (const entry of findStaleStylingEntries(manifest, violationsByRule[ruleName] ?? new Set())) {
    failureCount += 1;
    console.error(`stale styling manifest entry ${ruleName}: ${entry}`);
  }
}

for (const { registryName, path: registryPath } of listStylingRegistryFiles()) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    failureCount += 1;
    console.error(
      error?.code === 'ENOENT'
        ? `missing styling registry: ${path.relative(DEFAULT_REPO_ROOT, registryPath)}`
        : `invalid styling registry ${path.relative(DEFAULT_REPO_ROOT, registryPath)}: ${error}`
    );
    continue;
  }
  for (const error of validateStylingRegistry(registryName, registry)) {
    failureCount += 1;
    console.error(`invalid styling registry ${registryName}: ${error}`);
  }
}

if (failureCount > 0) {
  console.error(
    `\ncheck-styling-ratchets: ${failureCount} ${
      failureCount === 1 ? 'failure' : 'failures'
    }. Remove stale entries; styling migration manifests are shrink-only.`
  );
  process.exit(1);
}

console.log('check-styling-ratchets: manifests are exact and contain no stale entries.');
