import { createBoundExec, type BoundExec, type ExecOptions } from '#services/exec/api';
import {
  GitSchedule,
  WorktreeWriteLocks,
  type GitScheduleOptions,
  type GitWorkTier,
} from './git-schedule';

const GIT_ENV = {
  ...process.env,
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
};

/**
 * Probes never take git's optional locks (`GIT_OPTIONAL_LOCKS=0`): a `status` probe
 * must not contend with a real mutator over the index lock (spec: git hygiene).
 */
const PROBE_GIT_ENV = { ...GIT_ENV, GIT_OPTIONAL_LOCKS: '0' };

export type RegistryGitExecOptions = {
  /** Budget priority class; defaults to 'probe' (the safe floor for read paths). */
  tier?: GitWorkTier;
  /** Repository key for idle gating; only meaningful for tiers above 'probe'. */
  repository?: string;
};

/**
 * The runtime-owned git dependency bundle (spec: registry-runtime-carveout): the
 * subprocess budget, the per-worktree writer locks, and the budgeted exec factory,
 * injected into the executors and the scan plane instead of imported as process
 * globals. One context per runtime — two runtimes in one process never share gates.
 */
export type RegistryGitContext = {
  schedule: GitSchedule;
  locks: WorktreeWriteLocks;
  /** The budgeted git exec factory — {@link createRegistryGitExec} bound to `schedule`. */
  exec(cwd: string, options?: RegistryGitExecOptions): BoundExec;
};

/** Builds a real context; `GitScheduleOptions` is the composition-test lever. */
export function createRegistryGitContext(options: GitScheduleOptions = {}): RegistryGitContext {
  const schedule = new GitSchedule(options);
  return {
    schedule,
    locks: new WorktreeWriteLocks(),
    exec: (cwd, execOptions) => createRegistryGitExec(schedule, cwd, execOptions),
  };
}

/**
 * Every registry git subprocess flows through the context's budget (spec: git
 * concurrency model) — buffered exec calls acquire a slot for the subprocess's
 * lifetime at the caller's tier. `spawn` stays direct (its synchronous contract
 * cannot await a slot); spawn-based callers gate through `schedule.run` themselves.
 */
function createRegistryGitExec(
  schedule: GitSchedule,
  cwd: string,
  options: RegistryGitExecOptions = {}
): BoundExec {
  const tier = options.tier ?? 'probe';
  const work = { tier, repository: options.repository };
  const inner = createBoundExec({
    file: 'git',
    cwd,
    env: tier === 'probe' ? PROBE_GIT_ENV : GIT_ENV,
  });
  return {
    get file() {
      return inner.file;
    },
    get cwd() {
      return inner.cwd;
    },
    get env() {
      return inner.env;
    },
    exec: (args: string[], execOptions?: ExecOptions) =>
      schedule.run(work, () => inner.exec(args, execOptions)),
    execStreaming: (args, onStdout, execOptions) =>
      schedule.run(work, () => inner.execStreaming(args, onStdout, execOptions)),
    execBuffer: (args, execOptions) =>
      schedule.run(work, () => inner.execBuffer(args, execOptions)),
    spawn: (args, spawnOptions) => inner.spawn(args, spawnOptions),
    withCwd: (nextCwd: string) => createRegistryGitExec(schedule, nextCwd, options),
  };
}
