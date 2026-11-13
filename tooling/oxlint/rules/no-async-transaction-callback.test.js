import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

const invalid = {
  'drizzle-root.ts': 'db.transaction(async (tx) => { await tx.run(); });\n',
  'drizzle-nested.ts': 'db.transaction((tx) => { tx.transaction(async () => {}); });\n',
  'explicit-void.ts': 'db.transaction<void>(async () => {});\n',
  'store-handle.ts': 'handle.transaction(async function () {});\n',
  'in-transaction.ts': 'inTransaction(connection, async () => {});\n',
  'import-atomically.ts': 'importAtomically<void>(sqlite, async () => {});\n',
};

const valid = `
db.transaction((tx) => { tx.insert(table).values(row).run(); });
handle.transaction(() => handle.connection.run('DELETE FROM t'));
sqlite.transaction(() => {})();
inTransaction(connection, () => 1);
await importAtomically(sqlite, () => 2);
queue.run(async () => {});
`;

test('reports async SQLite transaction callbacks and allows synchronous ones', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-no-async-transaction-'));
  try {
    const configPath = path.join(tempRoot, '.oxlintrc.json');
    await writeFile(
      configPath,
      JSON.stringify({
        plugins: ['eslint', 'typescript'],
        jsPlugins: [path.join(repoRoot, 'tooling/oxlint/index.js')],
        env: { node: true, es2022: true },
        rules: { 'emdash/no-async-transaction-callback': 'error' },
      })
    );

    for (const [name, source] of Object.entries(invalid)) {
      const filePath = path.join(tempRoot, name);
      await writeFile(filePath, source);
      const result = await runOxlint(configPath, filePath);
      assert.notEqual(result.code, 0, `${name} should be reported`);
      assert.match(result.output, /emdash\(no-async-transaction-callback\)/);
    }

    const validPath = path.join(tempRoot, 'valid.ts');
    await writeFile(validPath, valid);
    const validResult = await runOxlint(configPath, validPath);
    assert.equal(validResult.code, 0, validResult.output);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function runOxlint(config, file) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'oxlint', '--config', config, file], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}
