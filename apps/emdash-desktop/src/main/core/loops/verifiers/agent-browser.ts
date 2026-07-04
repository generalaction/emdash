import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok } from '@main/lib/result';
import { safeMessage, sendPromptWithTimeout } from '../drivers/prompt-timeout';
import { buildAgentBrowserVerificationPrompt, parseVerificationSentinel } from '../prompt-builder';
import { checkCliAvailability } from './common';
import { tail } from './exec';
import type { LoopVerifier, VerifierError } from './types';

const id = 'agent-browser' as const;
const label = 'Agent Browser';
const DEFAULT_AGENT_BROWSER_VERIFY_TIMEOUT_MS = 15 * 60 * 1000;

function failure(input: {
  kind: VerifierError['kind'];
  message: string;
  cwd: string;
  command?: string;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  exitCode?: number | null;
  evidencePath?: string;
}): VerifierError {
  return {
    kind: input.kind,
    verifierId: id,
    message: input.message,
    cwd: input.cwd,
    ...(input.command ? { command: input.command } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.stdoutTail ? { stdoutTail: input.stdoutTail } : {}),
    ...(input.stderrTail ? { stderrTail: input.stderrTail } : {}),
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
  };
}

function promptSummary(finalText: string, evidenceDir: string): string {
  const text = tail(finalText.trim(), 4_000);
  return [text, `Screenshots/evidence: ${evidenceDir}`].filter(Boolean).join('\n\n');
}

export const agentBrowserVerifier: LoopVerifier = {
  id,
  label,

  checkAvailability(cwd) {
    return checkCliAvailability(id, 'agent-browser', ['--help'], cwd);
  },

  async run(ctx) {
    const criteria = ctx.criteria.filter((criterion) => criterion.verifier === id);
    if (criteria.length === 0) {
      return err(
        failure({
          kind: 'invalid-config',
          message: 'agent-browser has no phase criteria to verify',
          cwd: ctx.cwd,
        })
      );
    }

    if (!ctx.sessionDriver) {
      return err(
        failure({
          kind: 'invalid-config',
          message: 'agent-browser verification requires a loop session driver',
          cwd: ctx.cwd,
        })
      );
    }

    const startedAt = Date.now();
    const evidenceDir = join(ctx.cwd, '.emdash-loops-evidence', ctx.loop.id, ctx.phase.id);
    await mkdir(evidenceDir, { recursive: true });

    const session = await ctx.sessionDriver.startVerificationSession({
      loop: ctx.loop,
      phase: ctx.phase,
    });
    if (!session.success) {
      return err(
        failure({
          kind: 'command-failed',
          message: safeMessage(session.error.message, 'Failed to start agent-browser verification'),
          cwd: ctx.cwd,
          durationMs: Date.now() - startedAt,
          evidencePath: evidenceDir,
        })
      );
    }

    const command = `ACP verification: ${session.data.title}`;
    await ctx.setActiveConversation?.(session.data.conversationId, ctx.sessionDriver);

    try {
      const prompt = buildAgentBrowserVerificationPrompt({
        loop: ctx.loop,
        phase: ctx.phase,
        criteria,
        cwd: ctx.cwd,
        evidenceDir,
      });
      const promptResult = await sendPromptWithTimeout({
        driver: ctx.sessionDriver,
        conversationId: session.data.conversationId,
        prompt,
        timeoutMs: ctx.promptTimeoutMs ?? DEFAULT_AGENT_BROWSER_VERIFY_TIMEOUT_MS,
        failureMessage: 'Agent Browser verification prompt failed',
        timeoutLabel: 'Agent Browser verification prompt',
      });

      if (!promptResult.success) {
        const message = safeMessage(
          promptResult.error.message,
          'Agent Browser verification prompt failed'
        );
        return err(
          failure({
            kind: message.includes('timed out') ? 'timed-out' : 'command-failed',
            message,
            cwd: ctx.cwd,
            command,
            durationMs: Date.now() - startedAt,
            evidencePath: evidenceDir,
          })
        );
      }

      const finalText = promptResult.data.finalText;
      const stdoutTail = tail(finalText);
      const sentinel = parseVerificationSentinel(finalText);
      if (!sentinel) {
        return err(
          failure({
            kind: 'command-failed',
            message: `Agent Browser verification response did not include <<<LOOP:VERIFY_PASSED>>> or <<<LOOP:VERIFY_FAILED ...>>>`,
            cwd: ctx.cwd,
            command,
            durationMs: Date.now() - startedAt,
            stdoutTail,
            exitCode: 1,
            evidencePath: evidenceDir,
          })
        );
      }

      if (sentinel.kind === 'failed') {
        return err(
          failure({
            kind: 'command-failed',
            message: sentinel.reason,
            cwd: ctx.cwd,
            command,
            durationMs: Date.now() - startedAt,
            stdoutTail,
            exitCode: 1,
            evidencePath: evidenceDir,
          })
        );
      }

      return ok({
        verifierId: id,
        label,
        command,
        cwd: ctx.cwd,
        durationMs: Date.now() - startedAt,
        stdoutTail,
        stderrTail: '',
        exitCode: 0,
        summary: promptSummary(finalText, evidenceDir),
        evidencePath: evidenceDir,
      });
    } finally {
      await ctx.setActiveConversation?.(
        ctx.phase.conversationId,
        ctx.phase.conversationId ? ctx.sessionDriver : null
      );
    }
  },
};
