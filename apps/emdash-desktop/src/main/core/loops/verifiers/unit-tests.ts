import { err, ok, type Result } from '@main/lib/result';
import { errorFromExec } from './common';
import { CommandParseError, parseCommandLine, runExecFile, type ExecFileFailure } from './exec';
import type { LoopVerifier, VerifierAvailability, VerifierError, VerifierEvidence } from './types';

const id = 'unit-tests' as const;
const label = 'Unit tests';

export const unitTestsVerifier: LoopVerifier = {
  id,
  label,

  async checkAvailability(): Promise<Result<VerifierAvailability, VerifierError>> {
    return ok({ available: true });
  },

  async run(ctx): Promise<Result<VerifierEvidence, VerifierError>> {
    if (ctx.validationCommands.length === 0) {
      return ok({
        verifierId: id,
        label,
        command: '(no validation commands configured)',
        cwd: ctx.cwd,
        durationMs: 0,
        stdoutTail: '',
        stderrTail: '',
        exitCode: 0,
        summary: 'No validation commands were configured.',
      });
    }

    const startedAt = Date.now();
    const stdoutTails: string[] = [];
    const stderrTails: string[] = [];
    const commands: string[] = [];

    for (const command of ctx.validationCommands) {
      let parsed: ReturnType<typeof parseCommandLine>;
      try {
        parsed = parseCommandLine(command);
      } catch (error) {
        return err({
          kind: 'invalid-config',
          verifierId: id,
          message: error instanceof CommandParseError ? error.message : String(error),
          command,
          cwd: ctx.cwd,
        });
      }

      commands.push(command);

      try {
        const result = await runExecFile(parsed.file, parsed.args, {
          cwd: ctx.cwd,
          env: parsed.env,
          signal: ctx.signal,
          timeoutMs: 10 * 60_000,
        });
        stdoutTails.push(result.stdoutTail);
        stderrTails.push(result.stderrTail);
      } catch (failure) {
        return err(
          errorFromExec(id, failure as ExecFileFailure, `Validation command failed: ${command}`)
        );
      }
    }

    return ok({
      verifierId: id,
      label,
      command: commands.join(' && '),
      cwd: ctx.cwd,
      durationMs: Date.now() - startedAt,
      stdoutTail: stdoutTails.filter(Boolean).join('\n'),
      stderrTail: stderrTails.filter(Boolean).join('\n'),
      exitCode: 0,
      summary: 'Validation commands passed.',
    });
  },
};
