import { describe, expect, it } from 'vitest';
import { makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  buildAgentTmuxArgv,
  dispatchAgent,
  type AgentDispatchInput,
  type AgentSpawnRunner,
} from './agent-dispatch';

const base: AgentDispatchInput = {
  projectId: 'proj',
  taskId: 'task',
  conversationId: 'conv',
  providerId: 'opencode',
  providerConfig: { cli: 'opencode', initialPromptFlag: '--prompt' },
  autoApprove: false,
  prompt: 'fix the bug',
  cwd: '/work/tree',
  env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-test' },
};

function fakeRunner(opts: { present?: string[]; spawnOk?: boolean } = {}) {
  const live = new Set(opts.present ?? []);
  const spawns: string[][] = [];
  const envFiles: Array<Record<string, string>> = [];
  const runner: AgentSpawnRunner = {
    hasSession: (name) => live.has(name),
    writeEnvFile: (env) => {
      envFiles.push(env);
      return '/tmp/fake-env.sh';
    },
    spawn: (argv) => {
      spawns.push(argv);
      return { ok: opts.spawnOk ?? true };
    },
  };
  return { runner, spawns, envFiles };
}

describe('buildAgentTmuxArgv', () => {
  it('builds a detached tmux new-session that sources env from a file (no secrets in argv)', () => {
    const { tmuxSession, argv } = buildAgentTmuxArgv(base, { envFilePath: '/tmp/x.env' });

    expect(tmuxSession).toBe(makeTmuxSessionName(makePtySessionId('proj', 'task', 'conv')));
    expect(argv.slice(0, 6)).toEqual(['new-session', '-d', '-s', tmuxSession, '-c', '/work/tree']);
    // Secrets must NOT appear in argv.
    expect(argv.join(' ')).not.toContain('sk-test');
    expect(argv).not.toContain('-e');

    const agentLine = argv[argv.length - 1]!;
    // Sources + removes the env file (shell-quoted), then launches the agent.
    expect(agentLine).toContain(". '/tmp/x.env'");
    expect(agentLine).toContain("rm -f '/tmp/x.env'");
    expect(agentLine).toContain('opencode');
    expect(agentLine).toContain('--prompt');
    expect(agentLine).toContain('fix the bug');
  });

  it('prepends shellSetup when configured', () => {
    const { argv } = buildAgentTmuxArgv(
      { ...base, shellSetup: 'nvm use 20' },
      { envFilePath: '/tmp/x.env' }
    );
    expect(argv[argv.length - 1]!).toContain('nvm use 20 && ');
  });
});

describe('dispatchAgent', () => {
  it('spawns the session and reports the prompt delivered at launch', async () => {
    const { runner, spawns, envFiles } = fakeRunner();
    const res = await dispatchAgent(base, runner);
    expect(res).toMatchObject({ delivered: true, promptDelivered: true });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]![0]).toBe('new-session');
    // Env (incl. secrets) was handed to the env-file writer, not argv.
    expect(envFiles).toHaveLength(1);
    expect(envFiles[0]).toMatchObject({ ANTHROPIC_API_KEY: 'sk-test' });
  });

  it('treats an already-running session as up without re-spawning', async () => {
    const tmuxSession = makeTmuxSessionName(makePtySessionId('proj', 'task', 'conv'));
    const { runner, spawns } = fakeRunner({ present: [tmuxSession] });
    const res = await dispatchAgent(base, runner);
    expect(res).toMatchObject({ delivered: true, alreadyRunning: true });
    expect(spawns).toHaveLength(0);
  });

  it('reports promptDelivered:false for keystroke-injection providers (grok)', async () => {
    const { runner } = fakeRunner();
    const res = await dispatchAgent(
      { ...base, providerId: 'grok', providerConfig: { cli: 'grok' } },
      runner
    );
    expect(res.delivered).toBe(true);
    expect(res.promptDelivered).toBe(false);
    expect(res.reason).toBe('keystroke-provider');
  });

  it('fails closed when the spawn fails', async () => {
    const { runner } = fakeRunner({ spawnOk: false });
    const res = await dispatchAgent(base, runner);
    expect(res.delivered).toBe(false);
    expect(res.reason).toBe('spawn-failed');
  });
});
