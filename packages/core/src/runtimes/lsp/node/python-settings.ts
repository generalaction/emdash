import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';
import { formatAbsolute, type HostAbsolutePath } from '#primitives/path/api';

/** Discover interpreter paths on the host without executing project code. */
export async function pythonSettings(root: HostAbsolutePath, env: NodeJS.ProcessEnv) {
  const directory = formatAbsolute(root);
  const environments = [path.join(directory, '.venv'), path.join(directory, 'venv')];
  if (env.VIRTUAL_ENV && path.isAbsolute(env.VIRTUAL_ENV)) environments.push(env.VIRTUAL_ENV);
  let pythonPath: string | undefined;
  for (const environment of environments) {
    const candidate = path.join(
      environment,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      pythonPath = candidate;
      break;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))
        )
      )
        throw error;
    }
  }
  return {
    python: {
      ...(pythonPath ? { pythonPath } : {}),
      analysis: { diagnosticMode: 'openFilesOnly', autoSearchPaths: true },
    },
  };
}
