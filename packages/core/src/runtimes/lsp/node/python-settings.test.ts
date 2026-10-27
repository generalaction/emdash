import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNativeAbsolute } from '#primitives/path/api';
import { getServerProfile } from './server-registry';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-python-'));
  directories.push(directory);
  const parsed = parseNativeAbsolute(directory);
  if (!parsed.success) throw new Error('invalid root');
  const interpreter = (folder: string) =>
    path.join(
      directory,
      folder,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
  const createInterpreter = async (folder: string) => {
    const executable = interpreter(folder);
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, 'must not execute project code during discovery', { mode: 0o755 });
    return executable;
  };
  const settings = async (env: NodeJS.ProcessEnv = {}) =>
    (await getServerProfile('python').configure?.(parsed.data, env))?.settings;
  return { directory, interpreter, createInterpreter, settings };
}

describe('host Python environment', () => {
  it('limits diagnostics to open files and leaves interpreter discovery to Pyright without a venv', async () => {
    const f = await fixture();
    expect(await f.settings()).toEqual({
      python: {
        analysis: {
          diagnosticMode: 'openFilesOnly',
          autoSearchPaths: true,
        },
      },
    });
  });
  it.each(['.venv', 'venv'])('selects a project %s without executing it', async (folder) => {
    const f = await fixture();
    const executable = await f.createInterpreter(folder);
    expect(await f.settings()).toMatchObject({ python: { pythonPath: executable } });
  });
  it('prefers the project .venv over venv and an unrelated activated environment', async () => {
    const f = await fixture();
    const executable = await f.createInterpreter('.venv');
    await f.createInterpreter('venv');
    await f.createInterpreter('activated');
    expect(await f.settings({ VIRTUAL_ENV: path.join(f.directory, 'activated') })).toMatchObject({
      python: { pythonPath: executable },
    });
  });
  it('uses a captured activated environment when the project has no environment', async () => {
    const f = await fixture();
    const executable = await f.createInterpreter('activated');
    expect(await f.settings({ VIRTUAL_ENV: path.join(f.directory, 'activated') })).toMatchObject({
      python: { pythonPath: executable },
    });
  });
  it('skips directories masquerading as interpreters and missing environments', async () => {
    const f = await fixture();
    await mkdir(f.interpreter('.venv'), { recursive: true });
    expect(await f.settings({ VIRTUAL_ENV: path.join(f.directory, 'missing') })).not.toHaveProperty(
      'python.pythonPath'
    );
  });
  it('rediscovers the environment after it is created', async () => {
    const f = await fixture();
    expect(await f.settings()).not.toHaveProperty('python.pythonPath');
    const executable = await f.createInterpreter('.venv');
    expect(await f.settings()).toMatchObject({ python: { pythonPath: executable } });
  });
});
