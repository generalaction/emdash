import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';
import {
  classifyCorePath,
  classifyImportSpecifier,
  isAllowedCoreModuleDependency,
} from '../oxlint/rules/core-module-boundaries.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const desktopCoreRoot = path.join(repoRoot, 'apps/emdash-desktop/src/core');
const mainCoreRoot = path.join(repoRoot, 'apps/emdash-desktop/src/main/core');
const outputPath = path.join(repoRoot, 'tooling/oxlint/allowlists/core-boundaries.json');

async function collectSourceFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
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
    if (expression.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [argument] = expression.getArguments();
    if (argument?.getKind() === SyntaxKind.StringLiteral) {
      specifiers.push(argument.getLiteralValue());
    }
  }

  return specifiers;
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

const [coreFiles, mainCoreFiles] = await Promise.all([
  collectSourceFiles(desktopCoreRoot),
  collectSourceFiles(mainCoreRoot),
]);
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: false },
});
project.addSourceFilesAtPaths([...coreFiles, ...mainCoreFiles]);

const coreToHost = new Set();
const mainCoreToFeatures = new Set();
const crossSlice = new Set();

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  const specifiers = moduleSpecifiers(sourceFile);

  if (filePath.startsWith(`${desktopCoreRoot}${path.sep}`)) {
    if (
      specifiers.some(
        (specifier) => specifier.startsWith('@main/') || specifier.startsWith('@renderer/')
      )
    ) {
      coreToHost.add(repoRelative(filePath));
    }

    const sourceModule = classifyCorePath(filePath, desktopCoreRoot);
    if (
      sourceModule &&
      specifiers.some((specifier) => {
        const targetModule = classifyImportSpecifier(specifier, filePath, desktopCoreRoot);
        return targetModule && !isAllowedCoreModuleDependency(sourceModule, targetModule);
      })
    ) {
      crossSlice.add(repoRelative(filePath));
    }
  }

  if (
    filePath.startsWith(`${mainCoreRoot}${path.sep}`) &&
    specifiers.some((specifier) => specifier.startsWith('@core/features/'))
  ) {
    mainCoreToFeatures.add(repoRelative(filePath));
  }
}

const allowlists = {
  coreToHost: [...coreToHost].sort(),
  mainCoreToFeatures: [...mainCoreToFeatures].sort(),
  crossSlice: [...crossSlice].sort(),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(allowlists, null, 2)}\n`);

console.log(
  `Generated boundary allowlists: coreToHost=${allowlists.coreToHost.length}, ` +
    `mainCoreToFeatures=${allowlists.mainCoreToFeatures.length}, ` +
    `crossSlice=${allowlists.crossSlice.length}`
);
