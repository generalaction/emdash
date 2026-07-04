import type { Loop, LoopPhase, LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { VerifierError, VerifierEvidence } from './verifiers/types';

export const PHASE_DONE_SENTINEL = '<<<LOOP:PHASE_DONE>>>';
export const PHASE_FAILED_PREFIX = '<<<LOOP:PHASE_FAILED';
export const REVIEW_APPROVED_SENTINEL = '<<<LOOP:REVIEW_APPROVED>>>';
export const REVIEW_CHANGES_PREFIX = '<<<LOOP:REVIEW_CHANGES';

export type PhaseSentinel =
  | { kind: 'done' }
  | {
      kind: 'failed';
      reason: string;
    };

export type ReviewSentinel =
  | { kind: 'approved' }
  | {
      kind: 'changes';
      feedback: string;
    };

export type PhasePromptInput = {
  loop: Loop;
  phase: LoopPhase;
  attempt: number;
};

export type RetryPromptInput = {
  phase: LoopPhase;
  attempt: number;
  failures: Array<VerifierError | { kind: 'sentinel'; message: string }>;
  evidence: VerifierEvidence[];
  reviewFeedback?: string;
};

export type ReviewPromptInput = {
  loop: Loop;
  phase: LoopPhase;
  diff: string;
};

function criteriaLines(criteria: LoopPhaseCriterion[]): string {
  if (criteria.length === 0) return '- No explicit external verifier criteria were provided.';
  return criteria
    .map((criterion) => `- [ ] (${criterion.verifier}) ${criterion.description}`)
    .join('\n');
}

function validationLines(loop: Loop): string {
  const commands = loop.config?.validationCommands ?? [];
  if (commands.length === 0) return '- No validation commands configured.';
  return commands.map((command) => `- ${command}`).join('\n');
}

function failureLines(failures: RetryPromptInput['failures']): string {
  if (failures.length === 0) return '- No verifier failures were reported.';
  return failures
    .map((failure) => {
      if (failure.kind === 'sentinel') return `- Agent sentinel: ${failure.message}`;
      return [
        `- ${failure.verifierId}: ${failure.message}`,
        failure.command ? `  command: ${failure.command}` : undefined,
        failure.exitCode !== undefined ? `  exitCode: ${failure.exitCode}` : undefined,
        failure.stdoutTail ? `  stdout tail:\n${failure.stdoutTail}` : undefined,
        failure.stderrTail ? `  stderr tail:\n${failure.stderrTail}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function evidenceLines(evidence: VerifierEvidence[]): string {
  if (evidence.length === 0) return '- No passing verifier evidence yet.';
  return evidence
    .map((item) =>
      [
        `- ${item.verifierId}: ${item.summary}`,
        item.command ? `  command: ${item.command}` : undefined,
        item.evidencePath ? `  evidence: ${item.evidencePath}` : undefined,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n');
}

export function buildPhasePrompt(input: PhasePromptInput): string {
  const criteria = input.phase.criteria?.criteria ?? [];

  return `You are running an Emdash Loop phase.

Loop: ${input.loop.name}
Phase ${input.phase.idx + 1}: ${input.phase.name}
Attempt: ${input.attempt}

Goal:
${input.phase.goal}

Pass criteria:
${criteriaLines(criteria)}

Validation commands the loop engine will run after your turn:
${validationLines(input.loop)}

Required workflow:
1. ANNOUNCE: Briefly state the phase, intended files, and validation plan.
2. IMPLEMENT: Make the smallest correct change for this phase. Write unit tests first or alongside the implementation. This unit-test layer is mandatory.
3. VALIDATE: Run the validation commands yourself until they are green, or stop with an exact blocker you cannot resolve.
4. HONESTY: Never claim success you have not verified. If a command was not run, say exactly why. If blocked, record the exact command, error, and current state.

End your final response with exactly one sentinel:
- ${PHASE_DONE_SENTINEL}
- <<<LOOP:PHASE_FAILED reason>>>

Do not use a done sentinel unless the phase goal and pass criteria are actually satisfied.`;
}

export function buildRetryPrompt(input: RetryPromptInput): string {
  return `The loop verifier gate did not pass for phase ${input.phase.idx + 1}: ${input.phase.name}.

Attempt ${input.attempt} must address the failures below in the same conversation.

Failures:
${failureLines(input.failures)}

Passing evidence already collected:
${evidenceLines(input.evidence)}
${input.reviewFeedback ? `\nReview feedback:\n${input.reviewFeedback}\n` : ''}
Required response:
1. Explain the concrete fix.
2. Update the code/tests.
3. Re-run validation honestly.
4. End with ${PHASE_DONE_SENTINEL} or <<<LOOP:PHASE_FAILED reason>>>.`;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  return `Review this Emdash Loop phase diff.

Loop: ${input.loop.name}
Phase ${input.phase.idx + 1}: ${input.phase.name}

Goal:
${input.phase.goal}

Pass criteria:
${criteriaLines(input.phase.criteria?.criteria ?? [])}

Diff:
\`\`\`diff
${input.diff.trim() || '(no diff)'}
\`\`\`

Review rules:
- Approve only if the diff satisfies the phase goal and criteria.
- Call out missing tests, risky behavior, or unverifiable claims.
- Be specific and actionable.

End with exactly one sentinel:
- ${REVIEW_APPROVED_SENTINEL}
- <<<LOOP:REVIEW_CHANGES required changes>>>`;
}

export function parsePhaseSentinel(text: string): PhaseSentinel | null {
  if (text.includes(PHASE_DONE_SENTINEL)) return { kind: 'done' };

  const match = text.match(/<<<LOOP:PHASE_FAILED(?:\s+([\s\S]*?))?>>>/);
  if (!match) return null;

  return {
    kind: 'failed',
    reason: (match[1] ?? '').trim() || 'Agent reported phase failure',
  };
}

export function parseReviewSentinel(text: string): ReviewSentinel | null {
  if (text.includes(REVIEW_APPROVED_SENTINEL)) return { kind: 'approved' };

  const match = text.match(/<<<LOOP:REVIEW_CHANGES(?:\s+([\s\S]*?))?>>>/);
  if (!match) return null;

  return {
    kind: 'changes',
    feedback: (match[1] ?? '').trim() || 'Reviewer requested changes',
  };
}
