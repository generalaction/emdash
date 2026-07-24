import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';

const PACKAGE_NAME = '@emdash/core';
const SOURCE_DIRECTORY_NAMES = ['src', 'scripts'];
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const corePackagePath = path.join(repoRoot, 'packages/core/package.json');

async function collectSourceFiles(root) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files;
}

async function collectWorkspaceSourceFiles() {
  const files = [];
  for (const workspaceDirectory of ['apps', 'packages']) {
    const workspaceRoot = path.join(repoRoot, workspaceDirectory);
    const projects = await readdir(workspaceRoot, { withFileTypes: true });
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      for (const sourceDirectoryName of SOURCE_DIRECTORY_NAMES) {
        files.push(
          ...(await collectSourceFiles(path.join(workspaceRoot, project.name, sourceDirectoryName)))
        );
      }
    }
  }
  return files;
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [
    ...sourceFile
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue()),
    ...sourceFile
      .getExportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue())
      .filter(Boolean),
  ];

  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const [argument] = expression.getArguments();
    if (!argument || argument.getKind() !== SyntaxKind.StringLiteral) continue;
    const callee = expression.getExpression();
    const calleeText = callee.getText();
    if (
      callee.getKind() === SyntaxKind.ImportKeyword ||
      calleeText === 'vi.mock' ||
      calleeText === 'vi.doMock' ||
      calleeText === 'jest.mock' ||
      calleeText === 'jest.doMock'
    ) {
      specifiers.push(argument.getLiteralValue());
    }
  }

  return specifiers;
}

function exportKeyForSpecifier(specifier) {
  if (specifier === PACKAGE_NAME) return '.';
  if (!specifier.startsWith(`${PACKAGE_NAME}/`)) return undefined;
  return `.${specifier.slice(PACKAGE_NAME.length)}`;
}

function exportKeyMatches(exportKey, requestedKey) {
  const wildcardIndex = exportKey.indexOf('*');
  if (wildcardIndex === -1) return exportKey === requestedKey;
  const prefix = exportKey.slice(0, wildcardIndex);
  const suffix = exportKey.slice(wildcardIndex + 1);
  return requestedKey.startsWith(prefix) && requestedKey.endsWith(suffix);
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

const packageJson = JSON.parse(await readFile(corePackagePath, 'utf8'));
const exportKeys = Object.keys(packageJson.exports ?? {});
const sourceFiles = await collectWorkspaceSourceFiles();
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: true },
});
project.addSourceFilesAtPaths(sourceFiles);

const usages = new Map();
for (const sourceFile of project.getSourceFiles()) {
  for (const specifier of moduleSpecifiers(sourceFile)) {
    const exportKey = exportKeyForSpecifier(specifier);
    if (!exportKey) continue;
    const files = usages.get(exportKey) ?? new Set();
    files.add(repoRelative(sourceFile.getFilePath()));
    usages.set(exportKey, files);
  }
}

const missing = [...usages]
  .filter(
    ([requestedKey]) => !exportKeys.some((exportKey) => exportKeyMatches(exportKey, requestedKey))
  )
  .sort(([left], [right]) => left.localeCompare(right));

if (missing.length > 0) {
  console.error('Missing @emdash/core package exports:');
  for (const [exportKey, files] of missing) {
    console.error(`\n  ${exportKey}`);
    for (const file of [...files].sort()) console.error(`    - ${file}`);
  }
  console.error(
    '\nAdd matching entries to packages/core/tsdown.config.ts and packages/core/package.json.'
  );
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${usages.size} used @emdash/core subpaths against ${exportKeys.length} exports.`
  );
}
