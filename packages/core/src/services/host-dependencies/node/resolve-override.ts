import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { err, ok } from '@emdash/shared';
import type { IExecutionContext } from '#primitives/exec/api';
import type {
  HostDependencyResolveResult,
  InstallOverride,
} from '#primitives/host-dependencies/api';
import { resolveCommandPath } from '#services/host-dependencies/api/runtime/probe';

/** Runs on the owning host, alongside its filesystem and shell environment. */
export async function resolveOverride(
  id: string,
  selection: InstallOverride,
  exec: IExecutionContext
): Promise<HostDependencyResolveResult> {
  const invalid = (message: string) => err({ type: 'invalid-selection' as const, id, message });
  let path: string;
  if (selection.kind === 'path') {
    path = selection.path;
  } else if (isAbsolute(selection.command)) {
    path = selection.command;
  } else {
    if (!/^[^\s/\\\0]+$/.test(selection.command) || selection.command.startsWith('-')) {
      return invalid(
        'Enter a command name on PATH. For commands with arguments, use an executable wrapper script.'
      );
    }
    const resolved = await resolveCommandPath(selection.command, exec);
    if (!resolved)
      return invalid(`Command "${selection.command}" was not found on this host's PATH.`);
    path = resolved;
  }
  if (!isAbsolute(path) || path.includes('\0')) {
    return invalid('Enter an absolute path to an executable file.');
  }
  try {
    if (!(await stat(path)).isFile()) return invalid(`"${path}" is not a file.`);
    await access(path, constants.X_OK);
    if (process.platform === 'win32' && !/\.(exe|com|cmd|bat|ps1)$/i.test(extname(path))) {
      return invalid(`"${path}" is not a Windows executable (.exe, .com, .cmd, .bat or .ps1).`);
    }
    return ok({
      id,
      command: selection.kind === 'cli' ? selection.command : path,
      path,
      realpath: await realpath(path),
      source: selection,
    });
  } catch (error) {
    return invalid(
      `Cannot use "${path}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
