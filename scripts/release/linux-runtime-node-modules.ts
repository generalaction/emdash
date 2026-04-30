import { createRequire } from 'node:module';
import path from 'node:path';
import type { AfterPackContext } from 'app-builder-lib';
import fs from 'fs-extra';

const require = createRequire(import.meta.url);

function isLinuxPack(context: AfterPackContext): boolean {
  return context.electronPlatformName === 'linux';
}

function splitPackagePath(packageName: string): string[] {
  return packageName.startsWith('@') ? packageName.split('/') : [packageName];
}

async function readPackageJson(packageDir: string): Promise<{
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}> {
  return fs.readJson(path.join(packageDir, 'package.json'));
}

async function findPackageJsonFromEntry(entryPath: string, packageName: string): Promise<string> {
  let current = path.dirname(entryPath);
  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      if (packageJson?.name === packageName) {
        return packageJsonPath;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(`Unable to find package.json for ${packageName} from ${entryPath}`);
}

async function findPackageDirByNodeModulesLookup(
  parentDir: string,
  packageName: string
): Promise<string | null> {
  let current = path.resolve(parentDir);

  while (true) {
    const candidateDir = path.join(current, 'node_modules', ...splitPackagePath(packageName));
    const candidatePackageJson = path.join(candidateDir, 'package.json');

    if (await fs.pathExists(candidatePackageJson)) {
      const packageJson = await fs.readJson(candidatePackageJson);
      if (packageJson?.name === packageName) {
        return candidateDir;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

async function resolveInstalledPackageDir(parentDir: string, packageName: string): Promise<string> {
  try {
    const entryPath = require.resolve(packageName, { paths: [parentDir] });
    const packageJsonPath = await findPackageJsonFromEntry(entryPath, packageName);
    return path.dirname(packageJsonPath);
  } catch {
    const packageDir = await findPackageDirByNodeModulesLookup(parentDir, packageName);
    if (packageDir) {
      return packageDir;
    }
    throw new Error(`Unable to resolve installed package dir for ${packageName} from ${parentDir}`);
  }
}

async function copyPackageFiles(sourceDir: string, destinationDir: string): Promise<void> {
  await fs.copy(sourceDir, destinationDir, {
    dereference: false,
    filter: (_source, destinationLike) => {
      const rel = path.relative(sourceDir, destinationLike);
      if (rel === '') {
        return true;
      }
      return !rel.split(path.sep).includes('node_modules');
    },
  });
}

async function copyRuntimePackageTree(
  packageName: string,
  packageDir: string,
  destinationDir: string,
  ancestry: Set<string>
): Promise<void> {
  const realPackageDir = await fs.realpath(packageDir);
  if (ancestry.has(realPackageDir)) {
    return;
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(realPackageDir);

  await copyPackageFiles(packageDir, destinationDir);

  const packageJson = await readPackageJson(packageDir);
  const prodDependencies = packageJson.dependencies ?? {};
  const optionalDependencies = packageJson.optionalDependencies ?? {};

  for (const dependencyName of Object.keys(prodDependencies)) {
    const dependencyDir = await resolveInstalledPackageDir(realPackageDir, dependencyName);
    await copyRuntimePackageTree(
      dependencyName,
      dependencyDir,
      path.join(destinationDir, 'node_modules', ...splitPackagePath(dependencyName)),
      nextAncestry
    );
  }

  for (const dependencyName of Object.keys(optionalDependencies)) {
    try {
      const dependencyDir = await resolveInstalledPackageDir(realPackageDir, dependencyName);
      await copyRuntimePackageTree(
        dependencyName,
        dependencyDir,
        path.join(destinationDir, 'node_modules', ...splitPackagePath(dependencyName)),
        nextAncestry
      );
    } catch {
      continue;
    }
  }

  const copiedPackageJson = path.join(destinationDir, 'package.json');
  if (await fs.pathExists(copiedPackageJson)) {
    const copiedPackage = await fs.readJson(copiedPackageJson);
    delete copiedPackage.scripts;
    await fs.writeJson(copiedPackageJson, copiedPackage, { spaces: 2 });
  }
}

export async function injectLinuxRuntimeNodeModules(context: AfterPackContext): Promise<void> {
  if (!isLinuxPack(context)) {
    return;
  }

  const projectDir = context.packager.projectDir;
  const resourcesDir = path.join(context.appOutDir, 'resources');
  const runtimeNodeModulesDir = path.join(resourcesDir, 'node_modules');
  const projectPackageJson = await readPackageJson(projectDir);
  const rootDependencies = {
    ...(projectPackageJson.dependencies ?? {}),
    ...(projectPackageJson.optionalDependencies ?? {}),
  };

  await fs.remove(runtimeNodeModulesDir);
  await fs.ensureDir(runtimeNodeModulesDir);

  for (const packageName of Object.keys(rootDependencies)) {
    const packageDir = await resolveInstalledPackageDir(projectDir, packageName);
    await copyRuntimePackageTree(
      packageName,
      packageDir,
      path.join(runtimeNodeModulesDir, ...splitPackagePath(packageName)),
      new Set()
    );
  }
}
