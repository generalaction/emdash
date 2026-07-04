import type { Loop, LoopPhase, LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { VerifierError, VerifierEvidence } from './verifiers/types';

export const PHASE_DONE_SENTINEL = '<<<LOOP:PHASE_DONE>>>';
export const PHASE_FAILED_PREFIX = '<<<LOOP:PHASE_FAILED';
export const REVIEW_APPROVED_SENTINEL = '<<<LOOP:REVIEW_APPROVED>>>';
export const REVIEW_CHANGES_PREFIX = '<<<LOOP:REVIEW_CHANGES';
export const VERIFY_PASSED_SENTINEL = '<<<LOOP:VERIFY_PASSED>>>';
export const VERIFY_FAILED_PREFIX = '<<<LOOP:VERIFY_FAILED';

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

export type VerificationSentinel =
  | { kind: 'passed' }
  | {
      kind: 'failed';
      reason: string;
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

export type AgentBrowserVerificationPromptInput = {
  loop: Loop;
  phase: LoopPhase;
  criteria: LoopPhaseCriterion[];
  cwd: string;
  evidenceDir: string;
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

function numberedCriteriaLines(criteria: LoopPhaseCriterion[]): string {
  if (criteria.length === 0) return 'No agent-browser criteria were provided.';
  return criteria.map((criterion, index) => `${index + 1}. ${criterion.description}`).join('\n');
}

function targetLines(loop: Loop): string {
  const targetUrl = loop.config?.agentBrowser?.targetUrl?.trim();
  const cdpPort = loop.config?.agentBrowser?.cdpPort;
  return [
    `- Target URL: ${targetUrl || 'not configured'}`,
    `- CDP port: ${cdpPort ? String(cdpPort) : 'not configured'}`,
  ].join('\n');
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

export function buildAgentBrowserVerificationPrompt(
  input: AgentBrowserVerificationPromptInput
): string {
  return `You are an Emdash Loop VERIFICATION agent.

Loop: ${input.loop.name}
Phase ${input.phase.idx + 1}: ${input.phase.name}

You must NOT modify code, config, tests, or documentation. Your only job is to inspect the running UI and report whether the agent-browser criteria are actually satisfied.

Agent Browser criteria to verify:
${numberedCriteriaLines(input.criteria)}

Target:
${targetLines(input.loop)}
- Worktree: ${input.cwd}
- Screenshots/evidence directory: ${input.evidenceDir}

Required workflow:
1. Stay in the current worktree. If no target URL is configured, or if a configured target URL does not respond, start the project's dev server from this worktree in the background. Inspect package.json scripts and use the appropriate script, for example pnpm dev, then wait until it serves.
2. Drive the UI with the real agent-browser CLI primitives. Use commands such as agent-browser open, agent-browser connect, agent-browser snapshot -i, agent-browser click, agent-browser fill, agent-browser read, and agent-browser screenshot.
3. Verify EACH numbered criterion honestly against observed UI behavior. Do not infer success from code, logs, or intent alone.
4. Save screenshots under ${input.evidenceDir}. Use descriptive filenames tied to the criteria when practical.
5. Report the exact observed result for each criterion. If you cannot start or reach the UI, that is a verification failure with the exact command/error.

Honesty rules:
- Do not mark passed unless you actually drove the UI with agent-browser.
- Do not mark passed for a criterion you did not observe.
- Do not hide uncertainty. If behavior is ambiguous or blocked, fail with the observed reason.
- Do not edit files except for screenshots/evidence inside ${input.evidenceDir}.

End your final response with exactly one sentinel:
- ${VERIFY_PASSED_SENTINEL}
- <<<LOOP:VERIFY_FAILED criterion-numbers and exact observed reasons>>>`;
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

export function parseVerificationSentinel(text: string): VerificationSentinel | null {
  const matches = Array.from(text.matchAll(/<<<LOOP:VERIFY_(PASSED|FAILED)(?:\s+([\s\S]*?))?>>>/g));
  const match = matches.at(-1);
  if (!match) return null;

  if (match[1] === 'PASSED') return { kind: 'passed' };

  return {
    kind: 'failed',
    reason: (match[2] ?? '').trim() || 'Agent Browser verification failed',
  };
}
