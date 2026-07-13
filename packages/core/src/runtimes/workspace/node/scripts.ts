import { spawn } from 'node:child_process';
import { err, ok, type Result } from '@emdash/shared';
import type { HostFileRef } from '@primitives/path/api';
import type { LegacyWorkspaceAutomation, WorkspaceError } from '@runtimes/workspace/api';
import { nativePathFromWorkspace } from './provisioning/paths';

export type WorkspaceScriptKind = 'setup' | 'run' | 'teardown';

export type WorkspaceScriptRun = {
  workspace: HostFileRef;
  script: WorkspaceScriptKind;
  automation: LegacyWorkspaceAutomation;
  signal?: AbortSignal;
  appendOutput?: (chunk: string) => void;
};

export type WorkspaceScriptEngine = {
  run(input: WorkspaceScriptRun): Promise<Result<void, WorkspaceError>>;
  stopWorkspace(
    workspace: HostFileRef,
    options?: { signal?: AbortSignal }
  ): Promise<Result<void, WorkspaceError>>;
};

export class NodeWorkspaceScriptEngine implements WorkspaceScriptEngine {
  async run(input: WorkspaceScriptRun): Promise<Result<void, WorkspaceError>> {
    const command = input.automation[input.script];
    if (!command) return ok(undefined);

    const cwd = nativePathFromWorkspace(input.workspace);
    const fullCommand = input.automation.shellSetup
      ? `${input.automation.shellSetup}\n${command}`
      : command;

    return await new Promise((resolve) => {
      const child = spawn(fullCommand, {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: input.signal,
      });

      child.stdout.on('data', (chunk) => input.appendOutput?.(String(chunk)));
      child.stderr.on('data', (chunk) => input.appendOutput?.(String(chunk)));
      child.on('error', (error) => {
        resolve(
          err({
            type: 'script-failed',
            message: error.message,
          })
        );
      });
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolve(ok(undefined));
          return;
        }
        resolve(
          err({
            type: 'script-failed',
            message:
              signal !== null
                ? `${input.script} script exited with signal ${signal}`
                : `${input.script} script exited with code ${code ?? 'unknown'}`,
          })
        );
      });
    });
  }

  async stopWorkspace(): Promise<Result<void, WorkspaceError>> {
    return ok(undefined);
  }
}
