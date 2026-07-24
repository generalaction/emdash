import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Project, SyntaxKind } from 'ts-morph';

type ImportMap = Record<string, string>;

const repoRoot = path.resolve(import.meta.dirname, '../..');
const args = parseArgs(process.argv.slice(2));
const mappingPath = path.resolve(repoRoot, args.mapping);
const tsconfigPath = path.resolve(repoRoot, args.tsconfig);
const mapping = JSON.parse(await readFile(mappingPath, 'utf8')) as ImportMap;
const project = new Project({ tsConfigFilePath: tsconfigPath });
const changedFiles = new Set<string>();

for (const sourceFile of project.getSourceFiles()) {
  for (const declaration of sourceFile.getImportDeclarations()) {
    rewriteSpecifier(declaration.getModuleSpecifierValue(), (next) =>
      declaration.setModuleSpecifier(next)
    );
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier) rewriteSpecifier(specifier, (next) => declaration.setModuleSpecifier(next));
  }

  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const [argument] = expression.getArguments();
    if (!argument || argument.getKind() !== SyntaxKind.StringLiteral) continue;
    const callee = expression.getExpression();
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    const calleeText = callee.getText();
    const isModuleMock =
      calleeText === 'vi.mock' ||
      calleeText === 'vi.doMock' ||
      calleeText === 'jest.mock' ||
      calleeText === 'jest.doMock';
    if (!isDynamicImport && !isModuleMock) continue;
    const literal = argument.asKindOrThrow(SyntaxKind.StringLiteral);
    rewriteSpecifier(literal.getLiteralValue(), (next) => literal.setLiteralValue(next));
  }

  function rewriteSpecifier(current: string, apply: (next: string) => void): void {
    const next = resolveMapping(current, mapping);
    if (!next || next === current) return;
    apply(next);
    changedFiles.add(path.relative(repoRoot, sourceFile.getFilePath()));
  }
}

if (changedFiles.size === 0) {
  console.log('No shared imports require rewriting.');
  process.exit(0);
}

for (const file of [...changedFiles].sort()) console.log(file);

if (args.check) {
  console.error(`${changedFiles.size} file(s) contain shared imports that require rewriting.`);
  process.exit(1);
}

await project.save();
console.log(`Rewrote shared imports in ${changedFiles.size} file(s).`);

function resolveMapping(specifier: string, mapping: ImportMap): string | undefined {
  const exact = mapping[specifier];
  if (exact) return exact;

  const prefix = Object.keys(mapping)
    .filter((candidate) => candidate.endsWith('/*') && specifier.startsWith(candidate.slice(0, -1)))
    .sort((left, right) => right.length - left.length)[0];
  if (!prefix) return undefined;

  const target = mapping[prefix];
  if (!target.endsWith('/*')) {
    throw new Error(`Wildcard source '${prefix}' must map to a wildcard target`);
  }
  return `${target.slice(0, -1)}${specifier.slice(prefix.length - 1)}`;
}

function parseArgs(argv: string[]): {
  check: boolean;
  mapping: string;
  tsconfig: string;
} {
  let check = false;
  let mapping = 'tooling/scripts/shared-import-map.json';
  let tsconfig = 'apps/emdash-desktop/tsconfig.json';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--mapping' || arg === '--tsconfig') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      if (arg === '--mapping') mapping = value;
      else tsconfig = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { check, mapping, tsconfig };
}
