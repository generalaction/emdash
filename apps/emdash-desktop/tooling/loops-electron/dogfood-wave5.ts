import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron, type ElectronApplication, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const command = process.argv[2] ?? 'status';
const cdpPort = process.env.EMDASH_LOOPS_DOGFOOD_CDP_PORT;
const durableRoot =
  process.env.EMDASH_LOOPS_DOGFOOD_ROOT ??
  '/home/devuser/emdash/worktrees/emdash/acp-loops-v2/dogfood/wave5';
const worktreeRoot =
  process.env.EMDASH_LOOPS_DOGFOOD_WORKTREE_ROOT ??
  '/home/devuser/emdash/worktrees/summario/acp-loops-v2';
const sourceRepo = process.env.EMDASH_LOOPS_DOGFOOD_SOURCE ?? '/home/devuser/projects/summario';
const statePath = join(durableRoot, 'state.json');
const dbFile = join(durableRoot, 'emdash.db');
const userData = join(durableRoot, 'user-data');
const evidenceRoot = join(userData, 'loops', 'evidence');
const evidenceRunsAtLaunch = new Set(existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : []);
const projectId = 'acp-loops-v2-wave5-summario';
const taskId = 'acp-loops-v2-wave5-vocabulary';
const branchName = 'emdash/acp-loops-v2-wave5-vocabulary';
const remoteUrl = 'https://github.com/luisKisters/summario';

type RpcResult<T> = { success: true; data: T } | { success: false; error: unknown };
type Loop = {
  id: string;
  status: string;
  currentPhaseIndex: number;
  state?: {
    version: '2';
    checkpointCommit: string | null;
  } | null;
  phases: Array<{
    id: string;
    name: string;
    kind?: string;
    status: string;
    attempts: number;
    conversationId?: string | null;
    lastError?: string | null;
    state?: {
      checkpointCommit: string | null;
      result?: unknown;
    } | null;
  }>;
};
type DogfoodState = {
  version: 1;
  wave: 5;
  sourceRepo: string;
  baseRef: string;
  baseCommit: string;
  remoteUrl: string;
  projectId: string;
  taskId: string;
  loopId: string;
  workspaceId: string;
  workspacePath: string;
  branchName: string;
  envLocalPreserved: boolean;
  envLocalMode: string | null;
  previewServerId?: string;
  previewOrigin?: string;
  createdAt: string;
};

mkdirSync(durableRoot, { recursive: true, mode: 0o700 });
chmodSync(durableRoot, 0o700);

if (command === 'show') {
  process.stdout.write(readStateText());
  process.exit(0);
}

let electronApp: ElectronApplication | undefined;
let restoredVerifierRenderer = false;
try {
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [
      '.',
      '--no-sandbox',
      '--disable-gpu',
      '--password-store=basic',
      ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: externalAgentPath(),
      EMDASH_DB_FILE: dbFile,
      EMDASH_LOOPS_ELECTRON_TEST: '1',
      EMDASH_LOOPS_ELECTRON_USER_DATA: userData,
      EMDASH_DISABLE_PTY: '1',
      TELEMETRY_ENABLED: 'false',
    },
  });
  const page = await electronApp.firstWindow();
  page.on('console', (message) =>
    process.stderr.write(`[renderer:${message.type()}] ${message.text()}\n`)
  );
  page.on('pageerror', (error) => process.stderr.write(`[renderer:error] ${error.message}\n`));
  await page.waitForFunction(() => window.electronAPI !== undefined);
  assert.deepEqual(await invoke(page, 'loopsElectronTest.ping'), { mode: 'loops-electron' });
  await invoke(page, 'appSettings.update', 'experiments', { loops: true });

  if (command === 'prepare') {
    await prepare(page);
  } else if (command === 'preview') {
    await registerPreview(page);
  } else if (command === 'status') {
    await status(page);
  } else if (command === 'compact-status') {
    await compactStatus(page);
  } else if (command === 'start') {
    await start(page);
  } else if (command === 'retry') {
    await retry(page);
  } else if (command === 'adopt-review-correction') {
    await adoptReviewCorrection(page);
  } else if (command === 'resume') {
    await resume(page);
  } else {
    throw new Error(`Unknown Wave 5 dogfood command: ${command}`);
  }
} finally {
  await electronApp?.close().catch(() => undefined);
}

async function prepare(page: Page): Promise<void> {
  assert.equal(existsSync(statePath), false, `Dogfood state already exists at ${statePath}`);
  assert.equal(existsSync(sourceRepo), true, `Summario source checkout is missing: ${sourceRepo}`);
  const sourceStatusBefore = git(sourceRepo, ['status', '--porcelain=v1']);
  const baseCommit = git(sourceRepo, ['rev-parse', 'origin/main']).trim();

  const localProjectSettings = await invoke<Record<string, unknown>>(
    page,
    'appSettings.get',
    'localProject'
  );
  await invoke(page, 'appSettings.update', 'localProject', {
    ...localProjectSettings,
    defaultWorktreeDirectory: worktreeRoot,
  });

  const projects = await invoke<Array<{ id: string }>>(page, 'projects.getProjects');
  if (projects.some((project) => project.id === projectId)) {
    const opened = await invoke<RpcResult<{ repositoryWorkspaceId: string | null }>>(
      page,
      'projects.openProject',
      projectId
    );
    requireSuccess(opened, 'Wave 5 project reopen');
  } else {
    const createdProject = await invoke<RpcResult<{ id: string }>>(page, 'projects.createProject', {
      id: projectId,
      type: 'local',
      path: sourceRepo,
      name: 'summario-acp-loops-v2',
    });
    requireSuccess(createdProject, 'Wave 5 project creation');
  }

  const created = await invoke<RpcResult<{ task: { task: { workspaceId?: string } }; loop: Loop }>>(
    page,
    'loops.createTaskWithLoop',
    {
      task: {
        id: taskId,
        projectId,
        taskConfig: { version: '1', name: 'Wave 5 custom vocabulary pilot' },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName,
            fromBranch: {
              type: 'remote',
              branch: 'main',
              remote: { name: 'origin', url: remoteUrl },
            },
            pushBranch: false,
          },
          workspace: { kind: 'new-worktree' },
        },
      },
      loop: {
        name: 'Summario custom vocabulary pilot',
        model: 'gpt-5.6-sol',
        planSource: wave5PlanSource(),
        validationCommands: ['pnpm test', 'pnpm exec tsc --noEmit', 'pnpm lint', 'pnpm build'],
        terminalGates: { review: true, e2e: true },
        browserPreview: { enabled: true },
        workPhases: wave5WorkPhases(),
        acceptanceCriteria: [
          'Native preview proves default-on, opt-out, loading/failure/retry, editable/removable suggestions, persistence, manual-term preservation, edit flow, completed-Meeting absence, and continued transcription-context use.',
        ],
      },
    }
  );
  requireSuccess(created, 'Wave 5 task and Loop creation');

  const provisioned = await invoke<RpcResult<{ path: string; workspaceId: string }>>(
    page,
    'tasks.provisionWorkspace',
    taskId
  );
  requireSuccess(provisioned, 'Wave 5 workspace provisioning');
  assert.equal(
    git(provisioned.data.path, ['rev-parse', 'HEAD']).trim(),
    baseCommit,
    'Emdash workspace was not provisioned from the recorded origin/main base'
  );
  assert.equal(
    git(sourceRepo, ['status', '--porcelain=v1']),
    sourceStatusBefore,
    'Read-only Summario discovery checkout changed during Emdash provisioning'
  );

  const envPath = join(provisioned.data.path, '.env.local');
  const envLocalPreserved = existsSync(envPath);
  const envLocalMode = envLocalPreserved
    ? (statSync(envPath).mode & 0o777).toString(8).padStart(3, '0')
    : null;
  assert.equal(envLocalPreserved, true, 'Emdash did not preserve Summario .env.local');
  assert.equal(envLocalMode, '600', 'Preserved .env.local is not mode 0600');

  const state: DogfoodState = {
    version: 1,
    wave: 5,
    sourceRepo,
    baseRef: 'origin/main',
    baseCommit,
    remoteUrl,
    projectId,
    taskId,
    loopId: created.data.loop.id,
    workspaceId: provisioned.data.workspaceId,
    workspacePath: provisioned.data.path,
    branchName,
    envLocalPreserved,
    envLocalMode,
    createdAt: new Date().toISOString(),
  };
  writeMode600Json(statePath, state);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function status(page: Page): Promise<void> {
  const state = readState();
  const loop = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(loop, 'Wave 5 Loop read');
  process.stdout.write(
    `${JSON.stringify(
      {
        state,
        loop: {
          id: loop.data.id,
          status: loop.data.status,
          currentPhaseIndex: loop.data.currentPhaseIndex,
          phases: loop.data.phases,
        },
        workspaceHead: git(state.workspacePath, ['rev-parse', 'HEAD']).trim(),
        workspaceClean: git(state.workspacePath, ['status', '--porcelain=v1']) === '',
      },
      null,
      2
    )}\n`
  );
}

async function compactStatus(page: Page): Promise<void> {
  const state = readState();
  const loop = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(loop, 'Wave 5 compact Loop read');
  process.stdout.write(
    `${JSON.stringify(
      {
        status: loop.data.status,
        currentPhaseIndex: loop.data.currentPhaseIndex,
        checkpointCommit: loop.data.state?.checkpointCommit ?? null,
        phases: loop.data.phases.map((phase) => ({
          id: phase.id,
          name: phase.name,
          kind: phase.kind,
          status: phase.status,
          attempts: phase.attempts,
          lastError: phase.lastError,
          checkpointCommit: phase.state?.checkpointCommit ?? null,
          result: phase.state?.result ?? null,
        })),
      },
      null,
      2
    )}\n`
  );
}

async function registerPreview(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  const preview = await invoke<{ id: string; localPort?: number; url?: string }>(
    page,
    'loopsElectronTest.registerLocalPreview',
    {
      projectId,
      workspaceId: state.workspaceId,
      port: 3000,
    }
  );
  const previewOrigin = new URL(preview.url ?? `http://127.0.0.1:${preview.localPort ?? 3000}`)
    .origin;
  const nextState = {
    ...state,
    previewServerId: preview.id,
    previewOrigin,
  };
  writeMode600Json(statePath, nextState);
  process.stdout.write(
    `${JSON.stringify({ previewServerId: preview.id, previewOrigin }, null, 2)}\n`
  );
}

async function start(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  await registerPreview(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 5 pre-start Loop read');
  assert.equal(before.data.status, 'draft', `Wave 5 Loop is ${before.data.status}, not draft`);
  const started = await invoke<RpcResult<Loop>>(page, 'loops.startLoop', state.loopId);
  requireSuccess(started, 'Wave 5 Loop start');
  process.stdout.write(`Wave 5 Loop ${state.loopId} started.\n`);
  await monitor(page, state);
}

async function retry(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  await ensureCleanRoomRuntimeSettings(page);
  await registerPreview(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 5 pre-retry Loop read');
  assert.equal(before.data.status, 'failed', `Wave 5 Loop is ${before.data.status}, not failed`);
  const active = before.data.phases[before.data.currentPhaseIndex];
  assert.ok(active, 'Wave 5 failed without an active phase');
  const retried = await invoke<RpcResult<Loop>>(page, 'loops.retryPhase', state.loopId, active.id);
  requireSuccess(retried, 'Wave 5 Loop phase retry');
  process.stdout.write(`Wave 5 Loop ${state.loopId} retrying ${active.name}.\n`);
  await monitor(page, state);
}

async function resume(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  await ensureCleanRoomRuntimeSettings(page);
  await registerPreview(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 5 pre-resume Loop read');
  assert.equal(before.data.status, 'paused', `Wave 5 Loop is ${before.data.status}, not paused`);
  const resumed = await invoke<RpcResult<Loop>>(page, 'loops.resumeLoop', state.loopId);
  requireSuccess(resumed, 'Wave 5 Loop resume');
  process.stdout.write(`Wave 5 Loop ${state.loopId} resumed.\n`);
  await monitor(page, state);
}

async function ensureCleanRoomRuntimeSettings(page: Page): Promise<void> {
  const settingsPage = await invoke<
    RpcResult<{ settings: Record<string, unknown> & { scripts?: Record<string, string> } }>
  >(page, 'projects.getProjectSettingsPage', projectId);
  requireSuccess(settingsPage, 'Wave 5 project settings read');
  const updated = await invoke<RpcResult<Record<string, unknown>>>(
    page,
    'projects.updateProjectSettings',
    projectId,
    {
      ...settingsPage.data.settings,
      scripts: {
        ...settingsPage.data.settings.scripts,
        run: wave5ProductionPreviewScript(),
      },
    }
  );
  requireSuccess(updated, 'Wave 5 clean-room runtime settings');
  process.stdout.write('Wave 5 clean-room production lifecycle configured.\n');
}

function wave5ProductionPreviewScript(): string {
  return [
    'set -eu',
    'source_dir=$(pwd)',
    'pnpm build',
    'preview_dir=$(mktemp -d "${TMPDIR:-/tmp}/emdash-wave5-preview.XXXXXX")',
    `trap 'rm -rf "$preview_dir"' EXIT`,
    'cp -a .next package.json "$preview_dir"/',
    'for path in public next.config.* .env.local; do if [ -e "$path" ]; then cp -a "$path" "$preview_dir"/; fi; done',
    'ln -s "$source_dir/node_modules" "$preview_dir/node_modules"',
    'cd "$preview_dir"',
    '"$source_dir/node_modules/.bin/next" start',
  ].join('; ');
}

async function adoptReviewCorrection(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 5 pre-adoption Loop read');
  assert.equal(before.data.status, 'paused', 'Wave 5 Loop is not paused');
  const phase = before.data.phases[before.data.currentPhaseIndex];
  assert.ok(phase, 'Wave 5 current phase is unavailable');
  assert.equal(phase.kind, 'review', 'Wave 5 current phase is not Review');
  assert.equal(phase.status, 'pending', 'Wave 5 Review is not pending');
  const expectedCheckpoint = before.data.state?.checkpointCommit;
  assert.ok(expectedCheckpoint, 'Wave 5 checkpoint authority is unavailable');
  assert.equal(git(state.workspacePath, ['status', '--porcelain=v1']), '', 'Workspace is dirty');
  const checkpointCommit = git(state.workspacePath, ['rev-parse', 'HEAD']).trim();
  assert.equal(
    git(state.workspacePath, ['rev-parse', 'HEAD^']).trim(),
    expectedCheckpoint,
    'Review correction is not a direct child of Loop authority'
  );
  assert.equal(
    git(state.workspacePath, ['rev-list', '--count', `${expectedCheckpoint}..HEAD`]).trim(),
    '1',
    'Review correction must contain exactly one commit'
  );
  await invoke(page, 'loopsElectronTest.adoptTerminalCorrectionForRetry', {
    loopId: state.loopId,
    phaseId: phase.id,
    expectedCheckpoint,
    checkpointCommit,
  });
  process.stdout.write(`Adopted validated Review correction ${checkpointCommit}.\n`);
}

async function monitor(page: Page, state: DogfoodState): Promise<void> {
  let monitorPage = page;
  while (true) {
    let current: RpcResult<Loop>;
    try {
      current = await invoke<RpcResult<Loop>>(monitorPage, 'loops.getLoop', state.loopId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/Execution context was destroyed|Target page, context or browser has been closed/.test(
          message
        )
      ) {
        throw error;
      }
      monitorPage = await recoverMonitorPage();
      continue;
    }
    requireSuccess(current, 'Wave 5 Loop poll');
    const active = current.data.phases[current.data.currentPhaseIndex];
    process.stdout.write(
      `${new Date().toISOString()} ${current.data.status} ${active?.name ?? 'terminal'} ${active?.status ?? ''}\n`
    );
    if (current.data.status === 'completed') return;
    if (current.data.status === 'failed' || current.data.status === 'paused') {
      throw new Error(
        `Wave 5 Loop ${current.data.status}: ${active?.lastError ?? 'no phase error recorded'}`
      );
    }
    await delay(5_000);
  }
}

async function recoverMonitorPage(): Promise<Page> {
  assert.ok(electronApp, 'Wave 5 Electron app is unavailable during monitor recovery');
  // Electron temporarily exposes the native guest webview in place of the app renderer.
  // Keep the harness alive for the bounded E2E window so a cold preview or auth flow cannot
  // make the monitor close an otherwise healthy run.
  const deadline = Date.now() + 35 * 60_000;
  while (Date.now() < deadline) {
    const page = electronApp
      .windows()
      .find((candidate) => candidate.url().startsWith('app://emdash'));
    if (page) {
      await page.waitForFunction(() => window.electronAPI !== undefined);
      return page;
    }
    if (!restoredVerifierRenderer && hasNewEvidenceRun()) {
      const restored = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        await mainWindow.loadURL('app://emdash/index.html');
        return true;
      });
      restoredVerifierRenderer = restored;
    }
    await delay(250);
  }
  throw new Error('Wave 5 Emdash renderer did not recover after navigation');
}

function hasNewEvidenceRun(): boolean {
  if (!existsSync(evidenceRoot)) return false;
  return readdirSync(evidenceRoot).some((entry) => !evidenceRunsAtLaunch.has(entry));
}

async function ensureProjectOpen(page: Page): Promise<void> {
  const opened = await invoke<RpcResult<{ repositoryWorkspaceId: string | null }>>(
    page,
    'projects.openProject',
    projectId
  );
  requireSuccess(opened, 'Wave 5 project open');
}

async function invoke<T = unknown>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return (await page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), {
    channel,
    args,
  })) as T;
}

function requireSuccess<T>(
  result: RpcResult<T>,
  label: string
): asserts result is { success: true; data: T } {
  assert.equal(result.success, true, `${label} failed: ${JSON.stringify(result)}`);
}

function readState(): DogfoodState {
  return JSON.parse(readStateText()) as DogfoodState;
}

function readStateText(): string {
  assert.equal(existsSync(statePath), true, `Dogfood state does not exist at ${statePath}`);
  return readFileSync(statePath, 'utf8');
}

function writeMode600Json(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function externalAgentPath(): string {
  return (process.env.PATH ?? '')
    .split(':')
    .filter((entry) => entry && !entry.includes('/node_modules/.bin'))
    .join(':');
}

function wave5WorkPhases() {
  return [
    {
      name: 'Backend extraction contract',
      goal: `Implement the custom-vocabulary backend extraction contract described in the Loop plan. Read AGENTS.md, docs/conventions.md, and convex/_generated/ai/guidelines.md completely before editing. Use TDD. Keep the authenticated, ownership-checked suggestion path in the existing vocabulary-suggestion domain, derive only normalized/deduped customVocabulary from persisted exampleProtocol, preserve limits and manual terms, and add the strictly guarded local/test agent fixture. Add .convex/ to tracked .gitignore. Do not run Convex deployment or codegen commands; the lead exclusively owns the backend lease. Run focused tests and commit only this phase's coherent changes.`,
    },
    {
      name: 'Template setup UX',
      goal: `Implement the Template setup UX described in the Loop plan. Read the phase handoff and repository instructions before editing. Add the default-on suggestion switch, loading/error/retry states, editable Details chips, and durable OAuth/back-navigation persistence. Extract only pure versioned draft logic to lib/templateSetupDraft.ts with tests covering legacy v1 restore, new save/restore, corrupt or missing fields, and the default-on invariant. Preserve manual setup after failure. Do not run Convex deployment or codegen commands. Run focused tests and commit only this phase's coherent changes.`,
    },
    {
      name: 'Completed Meeting cleanup and docs',
      goal: `Complete the Meeting cleanup and documentation phase described in the Loop plan. Remove the vocabulary-suggestion entry point from summarized and approved Meetings, audit every reference and generated API use before deleting the panel or old endpoints, reuse normalization code where appropriate, and update README.md, docs/product.md, and docs/architecture.md only where claims changed. Preserve transcription-context behavior. Do not run Convex deployment or codegen commands. Run focused tests and commit only this phase's coherent changes.`,
    },
  ];
}

function wave5PlanSource(): string {
  return `Execute Wave 5 of the approved ACP Loops v2 plan against this Emdash-provisioned Summario worktree. The source checkout is read-only. Use Codex gpt-5.6-sol and a fresh ACP conversation for every ordered phase. Follow AGENTS.md and every referenced repository instruction. The lead exclusively owns the fresh non-production Convex backend, lifecycle processes, preview origin, fixtures, credential provisioning, and cleanup; implementation sessions must not change credential configuration or run Convex deployment/codegen commands. Credentials in the exact bound verification workspace are available to the verification agent. The agent may read them at runtime and enter them through the application when authentication is required; credential access, application use, or ordinary process diagnostics are not automatic failures. Never print credential values or persist them in repository files, prompts, logs, screenshots, or evidence. The bound local backend intentionally has no live Google OAuth client. For OAuth draft-restoration acceptance, do not invoke drive:startOAuth or leave the exact allowed origin; persist the wizard draft, then use same-origin drive=error or return-query navigation and guarded local/test fixtures as needed to emulate the OAuth return and prove restoration without console or network errors. Required backend tests cover the live OAuth contract. A prior exact-checkpoint attempt found that dismissed vocabulary suggestions can reappear and preserved a candidate correction; verify that behavior, implement the minimal correction in the disposable clean room if it remains reproducible, commit it, and return the correction-ready sentinel so Emdash can integrate it and require a fresh replay. Keep changes minimal and modular, use TDD, respect each phase's file ownership, preserve manual vocabulary and transcription-context behavior, and never push or open a PR. Terminal Review must verify authorization, cross-user rejection, normalization and limits, guarded-fixture denial paths, draft versioning/default-on behavior, UX states, reference removal, documentation accuracy, simplicity, clean git state, and absence of intentionally persisted raw credentials. Independent clean-room E2E must use the exact replayed checkpoint and Emdash native preview/browser verifier; it must prove default-on, opt-out, loading/failure/retry, editable/removable suggestions, persistence across back navigation and OAuth draft restore, manual-term preservation, edit flow, completed-Meeting absence, and continued transcription-context use, with no console/network errors. Run pnpm test, pnpm exec tsc --noEmit, pnpm lint, and pnpm build. Do not claim success unless every phase, Review, native clean-room E2E, replay, and required gate is green.`;
}
