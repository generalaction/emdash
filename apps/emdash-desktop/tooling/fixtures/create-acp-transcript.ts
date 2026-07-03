/**
 * Generic ACP transcript fixture generator.
 *
 * Prerequisites (must be satisfied before running):
 *   1. Workspace packages built: run `pnpm build` from the repo root so that
 *      @emdash/core/acp, @emdash/plugins/agents, and @emdash/shared resolve
 *      from their dist/ directories.
 *   2. Target agent CLI installed and authenticated, e.g. `claude` on PATH.
 *   3. Network + API-token access (real model calls are made).
 *
 * Usage:
 *   node --experimental-strip-types tooling/fixtures/create-acp-transcript.ts \
 *     [--provider claude] [--model claude-sonnet-5] [--cwd /tmp/my-worktree] \
 *     [--out tooling/fixtures/transcripts/claude-acp-transcript.json]
 *
 * Environment overrides:
 *   EMDASH_<PROVIDERID_UPPER>_BIN   - absolute path to the provider CLI binary
 *   EMDASH_CLI_PATH                 - generic CLI binary path override
 *
 * Safety: by default a throw-away `git worktree` is created from HEAD so all
 * agent file edits are isolated. Pass --cwd to run in-place or against an
 * external clone. The worktree is removed in a finally block.
 */
import { execSync, execFileSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { isErr } from '@emdash/shared';
import { createAcpAgentConnection } from '@emdash/core/acp';
import { pluginRegistry } from '@emdash/plugins/agents';
import { Recorder } from './acp/recorder';
import { RecordingHost } from './acp/recording-host';
import { buildRecordingClient } from './acp/recording-client';
import {
  scenario,
  type ConfigOption,
  type SessionMode,
} from './acp/scenario';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TranscriptOptions {
  /** Registered provider id, e.g. 'claude'. */
  providerId: string;
  /** Optional model override — passed to newSession if not null. */
  model?: string | null;
  /**
   * Working directory for the agent session.
   * When omitted a throwaway git worktree is created at HEAD and removed on exit.
   */
  cwd?: string;
  /** Output file path. Defaults to `tooling/fixtures/transcripts/<providerId>-acp-transcript.json`. */
  out?: string;
}

// ---------------------------------------------------------------------------
// Git worktree helpers
// ---------------------------------------------------------------------------

function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

function createWorktree(): string {
  const root = repoRoot();
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  const tmpDir = `/tmp/emdash-acp-fixture-${Date.now()}`;
  console.log(`[fixture] Creating throwaway worktree at ${tmpDir} (branch: ${branch})`);
  execFileSync('git', ['worktree', 'add', '--detach', tmpDir, 'HEAD'], {
    cwd: root,
    stdio: 'inherit',
  });
  return tmpDir;
}

function removeWorktree(path: string): void {
  try {
    const root = repoRoot();
    execFileSync('git', ['worktree', 'remove', '--force', path], {
      cwd: root,
      stdio: 'inherit',
    });
    console.log(`[fixture] Removed worktree ${path}`);
  } catch (e) {
    console.warn(`[fixture] Could not remove worktree ${path}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export async function runAcpTranscript(opts: TranscriptOptions): Promise<void> {
  // -- Resolve plugin behavior -----------------------------------------------
  const plugin = pluginRegistry.get(opts.providerId);
  if (!plugin) {
    throw new Error(`[fixture] Unknown provider '${opts.providerId}'. Is it registered?`);
  }
  if (plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior?.acp) {
    throw new Error(`[fixture] Provider '${opts.providerId}' does not support ACP transport.`);
  }
  const behavior = plugin.behavior.acp;

  // -- Resolve output path ---------------------------------------------------
  const outPath = opts.out
    ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out))
    : resolve(process.cwd(), `tooling/fixtures/transcripts/${opts.providerId}-acp-transcript.json`);

  // -- Set up CWD (worktree or caller-supplied) --------------------------------
  let worktreePath: string | null = null;
  let cwd: string;
  if (opts.cwd) {
    cwd = isAbsolute(opts.cwd) ? opts.cwd : resolve(process.cwd(), opts.cwd);
    console.log(`[fixture] Using caller-supplied cwd: ${cwd}`);
  } else {
    cwd = createWorktree();
    worktreePath = cwd;
  }

  const recorder = new Recorder({
    providerId: opts.providerId,
    model: opts.model ?? null,
    cwd,
  });
  const host = new RecordingHost();

  let sessionId: string | null = null;
  const { client, dispose: disposeClient } = buildRecordingClient(
    recorder,
    host,
    () => sessionId
  );

  const connResult = await createAcpAgentConnection(
    { host, behavior },
    {
      providerId: opts.providerId,
      cwd,
      buildClient: () => client,
      onClosed: () => {
        console.log('[fixture] Agent process closed.');
      },
    }
  );

  if (isErr(connResult)) {
    if (worktreePath) removeWorktree(worktreePath);
    throw new Error(`[fixture] Spawn failed: ${JSON.stringify(connResult.error)}`);
  }

  const { handle, agent, initialized } = connResult.data

  try {
    // -- Initialize ----------------------------------------------------------
    console.log('[fixture] Awaiting initialize…');
    const initResult = await initialized;
    if (isErr(initResult)) {
      throw new Error(`[fixture] Initialize failed: ${JSON.stringify(initResult.error)}`);
    }
    console.log('[fixture] Initialized.', initResult.data);

    // -- newSession ----------------------------------------------------------
    console.log('[fixture] Calling newSession…');
    const sessionResp = await agent.newSession({ cwd, mcpServers: [] });
    sessionId = sessionResp.sessionId;
    console.log(`[fixture] Session started: ${sessionId}`);

    const initialModes = sessionResp.modes?.availableModes ?? [];
    const initialConfigOptions = sessionResp.configOptions ?? [];

    recorder.meta = {
      ...recorder.meta,
      sessionId,
      generatedAt: new Date().toISOString(),
      initialModes,
      initialConfigOptions,
      initialAvailableCommands: null,
    };

    // -- Scenario loop -------------------------------------------------------
    let stepIndex = 0;
    for (const step of scenario) {
      stepIndex++;
      console.log(`\n[fixture] Step ${stepIndex}/${scenario.length}: kind=${step.kind}`);

      if (!sessionId) {
        console.warn('[fixture] No active sessionId — skipping step');
        continue;
      }

      if (step.kind === 'prompt') {
        const content = [{ type: 'text' as const, text: step.text }];
        recorder.record({ kind: 'prompt', sessionId, content });

        console.log(`[fixture] → prompt: "${step.text.slice(0, 60)}…"`);
        const promptResp = await agent.prompt({ sessionId, prompt: content });
        const stopReason = promptResp.stopReason ?? null;
        console.log(`[fixture] ← stopReason: ${stopReason}`);
        recorder.record({ kind: 'prompt_result', sessionId, stopReason });
      } else if (step.kind === 'setModel') {
        if (!agent.setSessionConfigOption) {
          console.log('[fixture] Agent does not support setSessionConfigOption — skipping setModel');
          continue;
        }
        const modelValue = step.resolveModel(initialConfigOptions);
        if (!modelValue) {
          console.log('[fixture] No alternative model found — skipping setModel');
          continue;
        }
        console.log(`[fixture] → setSessionConfigOption model=${modelValue}`);
        const resp = await agent.setSessionConfigOption({
          sessionId,
          configId: 'model',
          value: modelValue,
        });
        recorder.record({
          kind: 'config_option_set',
          sessionId,
          configId: 'model',
          value: modelValue,
          responseConfigOptions: resp?.configOptions ?? null,
        });
      } else if (step.kind === 'setEffort') {
        if (!agent.setSessionConfigOption) {
          console.log('[fixture] Agent does not support setSessionConfigOption — skipping setEffort');
          continue;
        }
        const effortConfig = initialConfigOptions.find(
          (c) =>
            c.category === 'thought_level' ||
            c.id === 'thought_level' ||
            c.id === 'effort' ||
            c.id.toLowerCase().includes('effort') ||
            c.id.toLowerCase().includes('thinking')
        );
        if (!effortConfig) {
          console.log('[fixture] No effort config found — skipping setEffort');
          continue;
        }
        const effortValue = step.resolveEffort(initialConfigOptions);
        if (!effortValue) {
          console.log('[fixture] No alternative effort value found — skipping setEffort');
          continue;
        }
        console.log(`[fixture] → setSessionConfigOption ${effortConfig.id}=${effortValue}`);
        const resp = await agent.setSessionConfigOption({
          sessionId,
          configId: effortConfig.id,
          value: effortValue,
        });
        recorder.record({
          kind: 'config_option_set',
          sessionId,
          configId: effortConfig.id,
          value: effortValue,
          responseConfigOptions: resp?.configOptions ?? null,
        });
      } else if (step.kind === 'setMode') {
        if (!agent.setSessionMode) {
          console.log('[fixture] Agent does not support setSessionMode — skipping setMode');
          continue;
        }
        const modeId = step.resolveMode(initialModes);
        if (!modeId) {
          console.log('[fixture] No alternative mode found — skipping setMode');
          continue;
        }
        console.log(`[fixture] → setSessionMode modeId=${modeId}`);
        await agent.setSessionMode({ sessionId, modeId });
        recorder.record({ kind: 'mode_set', sessionId, modeId });
      }
    }

    // -- Close session -------------------------------------------------------
    console.log('\n[fixture] Closing session…');
    try {
      await agent.closeSession?.({ sessionId });
    } catch (e) {
      console.warn('[fixture] closeSession error (non-fatal):', e);
    }
  } finally {
    disposeClient();
    try {
      handle.kill();
    } catch {
      // ignore if already exited
    }
    if (worktreePath) removeWorktree(worktreePath);

    // -- Persist -------------------------------------------------------------
    console.log(`\n[fixture] Saving transcript to ${outPath}…`);
    await recorder.save(outPath);
    console.log(
      `[fixture] Done. ${recorder.events.length} events recorded.`
    );
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseArgs(): TranscriptOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const providerId = get('--provider') ?? process.env['EMDASH_FIXTURE_PROVIDER'] ?? 'claude';
  const model = get('--model') ?? process.env['EMDASH_FIXTURE_MODEL'] ?? null;
  const cwd = get('--cwd') ?? process.env['EMDASH_FIXTURE_CWD'];
  const out = get('--out') ?? process.env['EMDASH_FIXTURE_OUT'];

  return { providerId, model, cwd, out };
}

const opts = parseArgs();
console.log('[fixture] Starting ACP transcript capture:', opts);
runAcpTranscript(opts).catch((e) => {
  console.error('[fixture] Fatal error:', e);
  process.exit(1);
});
