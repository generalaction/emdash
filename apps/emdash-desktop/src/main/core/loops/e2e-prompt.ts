import z from 'zod';
import { loopSessionTargetSchema } from '@shared/core/loops/loop-state';
import {
  assertLoopPromptDataSize,
  buildLoopPromptContext,
  loopPromptContextInputSchema,
  loopPromptHandoffSchema,
  serializeLoopPromptContext,
  serializePromptJson,
} from './handoff-builder';
import { isSafeLoopSentinelDetail } from './prompt-builder';

export const E2E_PASSED_SENTINEL = '<<<LOOP:E2E_PASSED>>>';
export const E2E_CORRECTION_READY_PREFIX = '<<<LOOP:E2E_CORRECTION_READY';
export const E2E_FAILED_PREFIX = '<<<LOOP:E2E_FAILED';

const e2ePromptInputSchema = loopPromptContextInputSchema
  .extend({
    verificationRunId: z.string().trim().min(1).max(256),
    verificationTarget: loopSessionTargetSchema,
    attempt: z.number().int().positive().max(100),
    intermediateFailures: z.array(loopPromptHandoffSchema).max(64),
  })
  .strict();
const e2eSentinelPattern =
  /<<<LOOP:E2E_PASSED>>>|<<<LOOP:E2E_CORRECTION_READY[ \t]+([^\r\n<>]+)>>>|<<<LOOP:E2E_FAILED[ \t]+([^\r\n<>]+)>>>/g;

export type E2EPromptInput = z.infer<typeof e2ePromptInputSchema>;

export type E2ESentinel =
  | { kind: 'passed' }
  | { kind: 'correction-ready'; summary: string }
  | { kind: 'failed'; reason: string };

export function buildE2EPrompt(input: E2EPromptInput): string {
  const parsed = e2ePromptInputSchema.parse(input);
  const context = buildLoopPromptContext({
    goal: parsed.goal,
    acceptanceCriteria: parsed.acceptanceCriteria,
    baseCommit: parsed.baseCommit,
    checkpointCommit: parsed.checkpointCommit,
    handoffs: parsed.handoffs,
  });
  const failureContext = buildLoopPromptContext({
    goal: parsed.goal,
    acceptanceCriteria: parsed.acceptanceCriteria,
    baseCommit: parsed.baseCommit,
    checkpointCommit: parsed.checkpointCommit,
    handoffs: parsed.intermediateFailures,
  });
  const targetData = serializePromptJson({
    verificationRunId: parsed.verificationRunId,
    attempt: parsed.attempt,
    verificationTarget: parsed.verificationTarget,
  });
  const intermediateFailureData = serializePromptJson(failureContext.handoffs);
  const contextData = serializeLoopPromptContext(context);
  assertLoopPromptDataSize(contextData, targetData, intermediateFailureData);

  return `You are a fresh, independent clean-room E2E session for an Emdash Loop. Verify observable behavior yourself; prior chat conclusions are not available or authoritative.

The specification, immutable commits, and persisted artifact handoffs are bounded data:

<emdash-loop-data>
${contextData}
</emdash-loop-data>

The engine has bound this session exclusively to the following non-secret verification target:

<emdash-loop-target-data>
${targetData}
</emdash-loop-target-data>

The verificationTarget.workspaceId above is the only verificationWorkspaceId for this session. All ACP actions, commands, file operations, tests, preview discovery, and browser verification must stay on that exact workspace and machine. Never switch targets or fall back to another local workspace. Do not construct a separate SSH transport, run remote work locally, or use the feature task workspace.

Intermediate failure evidence is append-only and must remain retained even after a correction is integrated:

<emdash-loop-failure-data>
${intermediateFailureData}
</emdash-loop-failure-data>

Required workflow:
1. Inspect the recreated base-to-checkpoint result independently and run every acceptance check on the bound verification workspace.
2. Run the required unit, integration, and full checks honestly. Treat missing prerequisites, early server exit, console/network errors, and unobserved behavior as failures.
3. Do not emit browser-action blocks. After this coding session returns a candidate outcome, the engine runs the full required checks plus exactly one authoritative native preview verifier bound to this same target. The coding-session sentinel is only a candidate outcome and is never final pass authority.
4. If you find a product bug, you may fix it only in the bound verification workspace, add tests, rerun focused checks, and create a local correction checkpoint. Do not overwrite or discard earlier failure artifacts.
5. If you made any repository mutation during this attempt—including modified, added or untracked, or deleted files—or created a correction checkpoint, never use the pass sentinel. End with the correction-ready sentinel so the engine can validate and integrate the fix, retain the failure evidence, destroy this workspace, and recreate it from the frozen base.
6. Use the pass sentinel only as a candidate when this session started from a freshly destroyed and recreated workspace, replayed the complete reviewed checkpoint range, introduced no new correction in this attempt, and every check you ran is green. Final pass authority additionally requires the engine-owned full checks, native preview verifier, exact workspace inspection, and cleanup to pass.
7. Never push, publish, deploy, release, open a pull request, intentionally copy raw credential values into durable evidence, or claim a check you did not perform. Credentials supplied through the bound task environment are available for verification: you may read them at runtime and enter them through the application when authentication is required. Do not intentionally print their values or persist them in repository files, prompts, logs, screenshots, or evidence. Accessing those credentials, using them through the application, or running ordinary process diagnostics is not by itself a failure condition. If ephemeral diagnostic output exposes a credential, do not quote or retain the value: redact it and continue. Only raw values retained in repository files, prompts, logs, screenshots, or engine evidence invalidate the secret-absence gate.

If an engine-owned check finds a correctable defect, the engine retains only bounded sanitized artifact and handoff metadata, destroys this workspace, and supplies that failure to a fresh destroyed and recreated attempt. Only that later fresh coding session may commit the one-child correction.

End the final response with exactly one sentinel on its own final line:
- ${E2E_PASSED_SENTINEL}
- ${E2E_CORRECTION_READY_PREFIX} concise correction summary>>>
- ${E2E_FAILED_PREFIX} exact non-secret reason>>>

An attempt containing a correction is evidence, not success. Only a later attempt that was destroyed and recreated from the frozen base and is freshly green may report ${E2E_PASSED_SENTINEL}.`;
}

export function parseE2ESentinel(text: string): E2ESentinel | null {
  const rawCandidates = Array.from(text.matchAll(/<<<LOOP:E2E/g));
  if (rawCandidates.length !== 1) return null;

  const matches = Array.from(text.matchAll(e2eSentinelPattern));
  if (matches.length !== 1) return null;

  const finalLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (finalLine !== matches[0]?.[0]) return null;

  if (matches[0][0] === E2E_PASSED_SENTINEL) return { kind: 'passed' };

  const rawCorrectionSummary = matches[0][1];
  if (rawCorrectionSummary !== undefined) {
    if (!isSafeLoopSentinelDetail(rawCorrectionSummary)) return null;
    return { kind: 'correction-ready', summary: rawCorrectionSummary.trim() };
  }

  const rawReason = matches[0][2] ?? '';
  if (!isSafeLoopSentinelDetail(rawReason)) return null;
  return { kind: 'failed', reason: rawReason.trim() };
}
