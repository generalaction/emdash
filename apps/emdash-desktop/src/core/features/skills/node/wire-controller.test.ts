import { hostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { skillsContract } from '../api';
import { createSkillsWireController } from './wire-controller';

const remoteHost = hostRef('remote', 'ssh-3');

describe('createSkillsWireController', () => {
  it('forwards skill procedures to the selected host and releases the lease', async () => {
    const installSkill = vi.fn(async () => ok([]));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ agentConfig: { installSkill } }),
      release,
    }));
    const controller = createSkillsWireController({ runtimes: { session } as never });
    const skill = {
      id: 'review-code',
      skillMdContent: '# Review code',
      source: 'local' as const,
    };

    await expect(controller.call('install', { host: remoteHost, skill })).resolves.toEqual(ok([]));

    expect(session).toHaveBeenCalledWith(remoteHost);
    expect(installSkill).toHaveBeenCalledWith({ skill }, {});
    expect(release).toHaveBeenCalledOnce();
  });

  it('holds the host lease while the installed-skills model is attached', async () => {
    const source = liveSource([]);
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const release = vi.fn(async () => {});
    const controller = createSkillsWireController({
      runtimes: {
        session: () => ({
          ready: async () => ok({ agentConfig: { skills: { state } } }),
          release,
        }),
      } as never,
    });
    const topic = encodeTopic(skillsContract.installed.states.list.id, { host: remoteHost });

    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);
    expect(state).toHaveBeenCalledWith(undefined, 'list');
    expect(release).not.toHaveBeenCalled();

    await lease?.release();
    expect(release).toHaveBeenCalledOnce();
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
