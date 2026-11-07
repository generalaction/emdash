import type { CommandContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { MissingOmOSessionError, plugin, provider } from './index';

const commandContext: CommandContext = {
  cli: '/Applications/Agent tools/omo',
  autoApprove: false,
  model: '',
  sessionId: 'emdash-uuid',
};

describe('OmO launch contract', () => {
  it('passes prompt, model and extra arguments as intact argv values', () => {
    const prompt = 'a "quote"\n$(touch /tmp/unwanted); \'single\'';
    expect(
      provider.behavior.prompt?.buildCommand({
        ...commandContext,
        initialPrompt: prompt,
        model: 'provider/model',
        extraArgs: ['--thinking', 'high'],
      })
    ).toEqual({
      command: commandContext.cli,
      args: ['--model', 'provider/model', '--thinking', 'high', prompt],
      env: {},
    });
  });

  it('resumes only the captured session file without resending the prompt', () => {
    expect(
      provider.behavior.prompt?.buildCommand({
        ...commandContext,
        isResuming: true,
        providerSessionId: '/sessions/a "quoted" session.jsonl',
        initialPrompt: 'must not repeat',
      })
    ).toEqual({
      command: commandContext.cli,
      args: ['--session', '/sessions/a "quoted" session.jsonl'],
      env: {},
    });
  });

  it.each([undefined, '', ' \t\n'])('rejects resume with missing identifier %j', (id) => {
    expect(() =>
      provider.behavior.prompt?.buildCommand({
        ...commandContext,
        isResuming: true,
        providerSessionId: id,
      })
    ).toThrow(MissingOmOSessionError);
  });

  it('declares a valid independent npm provider without disabling lifecycle scripts', () => {
    expect(plugin.validate()).toEqual([]);
    expect(plugin.metadata.id).toBe('omo');
    expect(plugin.capabilities.acp.kind).not.toBe('supported');
    expect(plugin.capabilities.hostDependency).toMatchObject({
      id: 'omo',
      binaryNames: ['omo'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g omo-ai' }],
        linux: [{ method: 'npm', command: 'npm install -g omo-ai' }],
        windows: [{ method: 'npm', command: 'npm install -g omo-ai' }],
      },
    });
  });
});

describe('OmO agent directory', () => {
  const resolve = provider.behavior.plugins?.resolveConfigRoot;
  it.each([
    [{}, '/host/.omo/agent'],
    [{ HOME: '/env-home', USERPROFILE: '/profile' }, '/env-home/.omo/agent'],
    [{ USERPROFILE: '/profile' }, '/profile/.omo/agent'],
    [
      {
        OMO_CODING_AGENT_DIR: ' /omo ',
        SENPI_CODING_AGENT_DIR: '/senpi',
        PI_CODING_AGENT_DIR: '/pi',
      },
      '/omo',
    ],
    [{ OMO_CODING_AGENT_DIR: ' \t', SENPI_CODING_AGENT_DIR: ' /senpi ' }, '/senpi'],
    [{ OMO_CODING_AGENT_DIR: '', SENPI_CODING_AGENT_DIR: ' ', PI_CODING_AGENT_DIR: '/pi' }, '/pi'],
    [{ OMO_CODING_AGENT_DIR: 'nested/../agent' }, '/work/task/agent'],
    [{ OMO_CODING_AGENT_DIR: '~/agent' }, '/work/task/~/agent'],
  ])('matches launcher precedence for %j', (env, expected) => {
    expect(resolve?.({ env, homeDir: '/host', platform: 'linux', cwd: '/work/task' })).toBe(
      expected
    );
  });

  it.each(['relative', '~/agent'])('leaves %s unresolved without a launch cwd', (value) => {
    expect(
      resolve?.({
        env: { OMO_CODING_AGENT_DIR: value },
        homeDir: '/host',
        platform: 'macos',
      })
    ).toBe('');
  });

  it.each([
    [' D:\\agent ', undefined, 'D:\\agent'],
    ['agent', 'C:\\work\\task', 'C:\\work\\task\\agent'],
    ['~\\agent', 'C:\\work', 'C:\\work\\~\\agent'],
    ['\\agent', 'D:\\work', 'D:\\agent'],
    ['\\agent', undefined, ''],
    ['/agent', undefined, ''],
    ['/agent', 'D:\\work', 'D:\\agent'],
    ['D:agent', undefined, ''],
  ])('uses Windows path and environment semantics for %s', (value, cwd, expected) => {
    expect(
      resolve?.({
        env: { omo_coding_agent_dir: value },
        homeDir: 'C:\\host',
        platform: 'windows',
        cwd,
      })
    ).toBe(expected);
  });
});
