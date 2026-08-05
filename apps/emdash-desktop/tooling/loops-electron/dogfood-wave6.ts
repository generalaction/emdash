import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import {
  loadWave6LegalFacts,
  serializeWave6LegalFactsForPrompt,
  type Wave6LegalFacts,
} from './wave6-legal-facts';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const command = process.argv[2] ?? 'status';
const cdpPort = process.env.EMDASH_LOOPS_DOGFOOD_CDP_PORT;
const legalFactsPath = process.env.EMDASH_LOOPS_WAVE6_LEGAL_FACTS;
const legalFacts = command === 'prepare' ? loadPrepareFacts(legalFactsPath) : undefined;
const durableRoot =
  process.env.EMDASH_LOOPS_DOGFOOD_ROOT ??
  '/home/devuser/emdash/worktrees/emdash/acp-loops-v2/dogfood/wave6';
const worktreeRoot =
  process.env.EMDASH_LOOPS_DOGFOOD_WORKTREE_ROOT ??
  '/home/devuser/emdash/worktrees/summario/acp-loops-v2';
const sourceRepo = process.env.EMDASH_LOOPS_DOGFOOD_SOURCE ?? '/home/devuser/projects/summario';
const statePath = join(durableRoot, 'state.json');
const dbFile = join(durableRoot, 'emdash.db');
const userData = join(durableRoot, 'user-data');
const evidenceRoot = join(userData, 'loops', 'evidence');
const evidenceRunsAtLaunch = new Set(existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : []);
const projectId = 'acp-loops-v2-wave6-summario';
const taskId = 'acp-loops-v2-wave6-privacy-consent';
const branchName = 'emdash/acp-loops-v2-wave6-privacy-consent';
const remoteUrl = 'https://github.com/luisKisters/summario';

type RpcResult<T> = { success: true; data: T } | { success: false; error: unknown };
type Loop = {
  id: string;
  status: string;
  currentPhaseIndex: number;
  state?: { version: '2'; checkpointCommit: string | null } | null;
  phases: Array<{
    id: string;
    name: string;
    kind?: string;
    status: string;
    attempts: number;
    conversationId?: string | null;
    lastError?: string | null;
    state?: { checkpointCommit: string | null; result?: unknown } | null;
  }>;
};
type DogfoodState = {
  version: 1;
  wave: 6;
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
  privacyMode: Wave6LegalFacts['privacyMode'];
  legalFactsSha256: string;
  legalFactsApprovedAt: string;
  legalFactsSourceReference: string;
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
    assert.ok(legalFacts, 'Wave 6 prepare facts were not loaded');
    await prepare(page, legalFacts);
  } else if (command === 'preview') {
    await registerPreview(page);
  } else if (command === 'status') {
    await status(page, false);
  } else if (command === 'compact-status') {
    await status(page, true);
  } else if (command === 'start') {
    await start(page);
  } else if (command === 'retry') {
    await retry(page);
  } else if (command === 'adopt-review-correction') {
    await adoptReviewCorrection(page);
  } else if (command === 'resume') {
    await resume(page);
  } else {
    throw new Error(`Unknown Wave 6 dogfood command: ${command}`);
  }
} finally {
  await electronApp?.close().catch(() => undefined);
}

async function prepare(page: Page, facts: Wave6LegalFacts): Promise<void> {
  assert.equal(existsSync(statePath), false, `Dogfood state already exists at ${statePath}`);
  assert.equal(existsSync(sourceRepo), true, `Summario source checkout is missing: ${sourceRepo}`);
  const sourceStatusBefore = git(sourceRepo, ['status', '--porcelain=v1']);
  git(sourceRepo, ['fetch', 'origin', 'main']);
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
    requireSuccess(opened, 'Wave 6 project reopen');
  } else {
    const createdProject = await invoke<RpcResult<{ id: string }>>(page, 'projects.createProject', {
      id: projectId,
      type: 'local',
      path: sourceRepo,
      name: 'summario-acp-loops-v2-wave6',
    });
    requireSuccess(createdProject, 'Wave 6 project creation');
  }

  const created = await invoke<RpcResult<{ task: { task: { workspaceId?: string } }; loop: Loop }>>(
    page,
    'loops.createTaskWithLoop',
    {
      task: {
        id: taskId,
        projectId,
        taskConfig: { version: '1', name: 'Wave 6 privacy and consent acceptance' },
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
        name: 'Summario privacy and consent acceptance',
        model: 'gpt-5.6-sol',
        planSource: wave6PlanSource(facts),
        validationCommands: ['pnpm test', 'pnpm exec tsc --noEmit', 'pnpm lint', 'pnpm build'],
        terminalGates: { review: true, e2e: true },
        browserPreview: { enabled: true },
        workPhases: wave6WorkPhases(facts.privacyMode),
        acceptanceCriteria: [wave6AcceptanceCriterion(facts.privacyMode)],
      },
    }
  );
  requireSuccess(created, 'Wave 6 task and Loop creation');

  const provisioned = await invoke<RpcResult<{ path: string; workspaceId: string }>>(
    page,
    'tasks.provisionWorkspace',
    taskId
  );
  requireSuccess(provisioned, 'Wave 6 workspace provisioning');
  assert.equal(
    git(provisioned.data.path, ['rev-parse', 'HEAD']).trim(),
    baseCommit,
    'Emdash Wave 6 workspace was not provisioned from recorded origin/main'
  );
  assert.equal(
    git(sourceRepo, ['status', '--porcelain=v1']),
    sourceStatusBefore,
    'Read-only Summario discovery checkout changed during Wave 6 provisioning'
  );

  const envPath = join(provisioned.data.path, '.env.local');
  const envLocalPreserved = existsSync(envPath);
  const envLocalMode = envLocalPreserved
    ? (statSync(envPath).mode & 0o777).toString(8).padStart(3, '0')
    : null;
  assert.equal(envLocalPreserved, true, 'Emdash did not preserve Summario .env.local for Wave 6');
  assert.equal(envLocalMode, '600', 'Preserved Wave 6 .env.local is not mode 0600');

  const serializedFacts = serializeWave6LegalFactsForPrompt(facts);
  const state: DogfoodState = {
    version: 1,
    wave: 6,
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
    privacyMode: facts.privacyMode,
    legalFactsSha256: createHash('sha256').update(serializedFacts).digest('hex'),
    legalFactsApprovedAt: facts.approval.approvedAt,
    legalFactsSourceReference: facts.approval.sourceReference,
    envLocalPreserved,
    envLocalMode,
    createdAt: new Date().toISOString(),
  };
  writeMode600Json(statePath, state);
  process.stdout.write(
    `${JSON.stringify(
      {
        wave: state.wave,
        baseCommit: state.baseCommit,
        loopId: state.loopId,
        workspaceId: state.workspaceId,
        workspacePath: state.workspacePath,
        branchName: state.branchName,
        privacyMode: state.privacyMode,
        legalFactsSha256: state.legalFactsSha256,
        envLocalMode: state.envLocalMode,
      },
      null,
      2
    )}\n`
  );
}

async function status(page: Page, compact: boolean): Promise<void> {
  const state = readState();
  const loop = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(loop, 'Wave 6 Loop read');
  const summary = {
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
  };
  process.stdout.write(
    `${JSON.stringify(
      compact
        ? summary
        : {
            state,
            loop: summary,
            workspaceHead: git(state.workspacePath, ['rev-parse', 'HEAD']).trim(),
            workspaceClean: git(state.workspacePath, ['status', '--porcelain=v1']) === '',
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
    { projectId, workspaceId: state.workspaceId, port: 3000 }
  );
  const previewOrigin = new URL(preview.url ?? `http://127.0.0.1:${preview.localPort ?? 3000}`)
    .origin;
  writeMode600Json(statePath, { ...state, previewServerId: preview.id, previewOrigin });
  process.stdout.write(
    `${JSON.stringify({ previewServerId: preview.id, previewOrigin }, null, 2)}\n`
  );
}

async function start(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  await ensureCleanRoomRuntimeSettings(page);
  await registerPreview(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 6 pre-start Loop read');
  assert.equal(before.data.status, 'draft', `Wave 6 Loop is ${before.data.status}, not draft`);
  const started = await invoke<RpcResult<Loop>>(page, 'loops.startLoop', state.loopId);
  requireSuccess(started, 'Wave 6 Loop start');
  process.stdout.write(`Wave 6 Loop ${state.loopId} started.\n`);
  await monitor(page, state);
}

async function retry(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  await ensureCleanRoomRuntimeSettings(page);
  await registerPreview(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 6 pre-retry Loop read');
  assert.equal(before.data.status, 'failed', `Wave 6 Loop is ${before.data.status}, not failed`);
  const active = before.data.phases[before.data.currentPhaseIndex];
  assert.ok(active, 'Wave 6 failed without an active phase');
  const retried = await invoke<RpcResult<Loop>>(page, 'loops.retryPhase', state.loopId, active.id);
  requireSuccess(retried, 'Wave 6 Loop phase retry');
  process.stdout.write(`Wave 6 Loop ${state.loopId} retrying ${active.name}.\n`);
  await monitor(page, state);
}

async function resume(page: Page): Promise<void> {
  const state = readState();
  await ensureProjectOpen(page);
  await ensureCleanRoomRuntimeSettings(page);
  await registerPreview(page);
  const before = await invoke<RpcResult<Loop>>(page, 'loops.getLoop', state.loopId);
  requireSuccess(before, 'Wave 6 pre-resume Loop read');
  assert.equal(before.data.status, 'paused', `Wave 6 Loop is ${before.data.status}, not paused`);
  const resumed = await invoke<RpcResult<Loop>>(page, 'loops.resumeLoop', state.loopId);
  requireSuccess(resumed, 'Wave 6 Loop resume');
  process.stdout.write(`Wave 6 Loop ${state.loopId} resumed.\n`);
  await monitor(page, state);
}

async function ensureCleanRoomRuntimeSettings(page: Page): Promise<void> {
  const settingsPage = await invoke<
    RpcResult<{ settings: Record<string, unknown> & { scripts?: Record<string, string> } }>
  >(page, 'projects.getProjectSettingsPage', projectId);
  requireSuccess(settingsPage, 'Wave 6 project settings read');
  const updated = await invoke<RpcResult<Record<string, unknown>>>(
    page,
    'projects.updateProjectSettings',
    projectId,
    {
      ...settingsPage.data.settings,
      scripts: {
        ...settingsPage.data.settings.scripts,
        run: wave6ProductionPreviewScript(),
      },
    }
  );
  requireSuccess(updated, 'Wave 6 clean-room runtime settings');
  process.stdout.write('Wave 6 clean-room production lifecycle configured.\n');
}

function wave6ProductionPreviewScript(): string {
  return [
    'set -eu',
    'source_dir=$(pwd)',
    'pnpm build',
    'preview_dir=$(mktemp -d "${TMPDIR:-/tmp}/emdash-wave6-preview.XXXXXX")',
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
  requireSuccess(before, 'Wave 6 pre-adoption Loop read');
  assert.equal(before.data.status, 'paused', 'Wave 6 Loop is not paused');
  const phase = before.data.phases[before.data.currentPhaseIndex];
  assert.ok(phase, 'Wave 6 current phase is unavailable');
  assert.equal(phase.kind, 'review', 'Wave 6 current phase is not Review');
  assert.equal(phase.status, 'pending', 'Wave 6 Review is not pending');
  const expectedCheckpoint = before.data.state?.checkpointCommit;
  assert.ok(expectedCheckpoint, 'Wave 6 checkpoint authority is unavailable');
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
    requireSuccess(current, 'Wave 6 Loop poll');
    const active = current.data.phases[current.data.currentPhaseIndex];
    process.stdout.write(
      `${new Date().toISOString()} ${current.data.status} ${active?.name ?? 'terminal'} ${active?.status ?? ''}\n`
    );
    if (current.data.status === 'completed') return;
    if (current.data.status === 'failed' || current.data.status === 'paused') {
      throw new Error(
        `Wave 6 Loop ${current.data.status}: ${active?.lastError ?? 'no phase error recorded'}`
      );
    }
    await delay(5_000);
  }
}

async function recoverMonitorPage(): Promise<Page> {
  assert.ok(electronApp, 'Wave 6 Electron app is unavailable during monitor recovery');
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
  throw new Error('Wave 6 Emdash renderer did not recover after navigation');
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
  requireSuccess(opened, 'Wave 6 project open');
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

function loadPrepareFacts(path: string | undefined): Wave6LegalFacts {
  assert.ok(path, 'EMDASH_LOOPS_WAVE6_LEGAL_FACTS is required for Wave 6 prepare');
  return loadWave6LegalFacts(path);
}

function wave6WorkPhases(privacyMode: Wave6LegalFacts['privacyMode']) {
  return [
    {
      name: 'Truth and policy contract',
      goal: `Implement the approved Wave 6 truth and policy contract. Read AGENTS.md and docs/conventions.md, then inspect every truth-source seam named in the Loop plan. Treat the approved legal-facts JSON in the plan as the sole authority for controller identity, address, contact, jurisdiction, effective date, retention, deletion guarantees, legal bases, purposes, subprocessors, and optional technologies. Do not invent, broaden, or silently correct a legal fact; stop with an exact conflict if repository truth contradicts approval. Use TDD for lib/privacyPolicy.ts and lib/privacyPolicy.test.ts, reject placeholders and inconsistent claims, and add only the tracked .convex/ ignore rule if absent. Do not inspect the quarantined loops-acceptance branch. Do not run Convex deployment or codegen commands. Commit only this phase's coherent files.`,
    },
    {
      name: 'Transcript deletion truth gap',
      goal: `Prove the original transcript-deletion truth gap remains closed, writing failing integration tests first. The selected base already routes public remove, cron internalDelete, and generated-occurrence deletion through deleteMeetingWithOwnedState, which deletes transcriptStorageId before the document. Own only convex/meetings.ts, convex/lib/meetingDeletion.ts, convex/lib/transcriptStorage.ts, convex/cronActions.ts, convex/crons.ts, and convex/transcriptStorage.integration.test.ts. Preserve the existing ownership-safe helper unless tests expose a real gap; make only the minimal correction then. Prove both public meetings.remove and cron-driven internalDelete remove the meeting document and referenced transcript-storage blob without weakening authorization or idempotency. Do not run Convex deployment or codegen commands. Commit only this phase's coherent files.`,
    },
    {
      name: 'Privacy preference state',
      goal: `Implement versioned privacy preference state in lib/privacyPreferences.ts with TDD in lib/privacyPreferences.test.ts. The approved mode is ${privacyMode}. In consent mode, missing, corrupt, or stale state returns to undecided; Reject is as easy as Accept; reopen and withdrawal are supported. In notice mode, store only a versioned acknowledgement and render no fictional choices. Keep the module pure, bounded, and SSR-safe. Do not run Convex deployment or codegen commands. Commit only this phase's coherent files.`,
    },
    {
      name: 'Native privacy surface and real gate',
      goal: `Build the accessible privacy surface under components/privacy/, wire it through app/layout.tsx, and change only the approved optional-technology seam. The approved mode is ${privacyMode}. Required storage, authentication, meeting, editor, and deletion behavior must never depend on privacy preference state. Add a strictly local/test-guarded /agent/privacy-fixtures route with accessible controls for fresh, stale, and corrupt preference states so native clean-room E2E can verify recovery without browser-evaluate shortcuts. Test keyboard behavior, equal Reject/Accept prominence where applicable, reopen/withdrawal, mobile layout, and optional-network gating. Do not run Convex deployment or codegen commands. Commit only this phase's coherent files.`,
    },
    {
      name: 'Policy rendering and docs',
      goal: `Replace app/privacy/page.tsx placeholders by rendering only the structured approved policy model. Keep /privacy public and preserve the Footer link. Update README.md, docs/product.md, docs/architecture.md, and docs/runbook.md only where technical claims changed. Audit every displayed legal statement against the approved-facts block and current code; do not invent marketing or legal guarantees. Do not inspect or cherry-pick the quarantined loops-acceptance branch. Do not run Convex deployment or codegen commands. Commit only this phase's coherent files.`,
    },
  ];
}

function wave6AcceptanceCriterion(privacyMode: Wave6LegalFacts['privacyMode']): string {
  const common =
    'Native clean-room preview proves public anonymous /privacy rendering from the approved structured policy, authenticated core routes, reload persistence, guarded fresh/stale/corrupt preference recovery, keyboard operation, mobile layout, light/dark themes, and no console or network errors. Required authentication, meetings, storage, editor, and deletion behavior remains available.';
  return privacyMode === 'consent'
    ? `${common} In consent mode, Reject and Accept are equally accessible, Cal.com or every other approved optional technology makes no request before Accept, Reject leaves core behavior working, Accept enables only approved optional requests, and reopening then withdrawing blocks future optional requests.`
    : `${common} In notice mode, acknowledgement persists and can be reopened, while no Accept, Reject, withdrawal, or other fictional consent controls are rendered.`;
}

function wave6PlanSource(facts: Wave6LegalFacts): string {
  const approvedFacts = serializeWave6LegalFactsForPrompt(facts);
  return `Execute Wave 6 of the approved ACP Loops v2 plan against this separate Emdash-provisioned Summario worktree created from current origin/main. Use Codex gpt-5.6-sol and a fresh ACP conversation for every ordered phase. The source checkout is read-only. Follow AGENTS.md, docs/conventions.md, and convex/_generated/ai/guidelines.md when touching Convex code. Never inspect or cherry-pick the quarantined emdash/loops-acceptance branch during implementation; terminal Review may use it only as an adversarial list of past mistakes. The lead exclusively owns fresh non-production Convex deployment, codegen, lifecycle processes, preview origin, fixtures, credential provisioning, and cleanup. Implementation sessions must not run deployment or codegen commands. Credentials in the exact bound verification workspace may be read at runtime and entered through the application; never print their values or persist them in repository files, prompts, logs, screenshots, or evidence. Keep every phase inside its named ownership. Use TDD, focused tests, minimal modular changes, and coherent commits. The approved legal-facts block below is user/product-owner authority. Do not invent, omit, broaden, or silently revise it. If technical truth contradicts it, stop the phase and report the exact conflict instead of producing policy text.\n\nAPPROVED WAVE 6 LEGAL FACTS:\n${approvedFacts}\n\nPhase 1 must inspect schema, auth, providers, proxy, meetings, transcript storage, crons, series, templates, users, errors, Skribby, Gemini, Drive, public shares, Cal.com, editor, docs, env example, package manifest, and Vercel configuration, then implement a source-cited structured policy contract. Phase 2 must preserve the selected base's existing shared deletion helper unless failing tests expose a gap, and prove public and scheduled meeting deletion remove both the document and referenced transcript blob. Phase 3 implements versioned ${facts.privacyMode} preference state. Phase 4 implements the accessible native surface, gates only approved optional technology, and adds guarded fresh/stale/corrupt E2E fixtures. Phase 5 renders /privacy from the structured model and updates only changed technical documentation. Terminal Review must verify every claim against approved facts and code, authorization, transcript blob cleanup, no fake consent, accessibility, simplicity, clean Git state, and absence of persisted raw credentials. Independent E2E must replay the exact reviewed checkpoint, run pnpm test, pnpm exec tsc --noEmit, pnpm lint, and pnpm build, then prove the native acceptance criterion with secret-free evidence. Never push or open a PR. Do not claim success until all five work phases, Review, clean-room replay, native E2E, cleanup audit, and required gates are green.`;
}
