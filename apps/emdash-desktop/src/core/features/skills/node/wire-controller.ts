import type { HostRef } from '@emdash/core/primitives/host/api';
import { err, type PendingLease, type Result } from '@emdash/shared';
import type { LeasedLiveModelProvider, LiveSource } from '@emdash/wire';
import { createController, type CallMeta, type Controller } from '@emdash/wire/api';
import { skillsContract } from '../api';
import {
  throwSkillsRuntimeResolveError,
  type SkillsHostRuntimesClient as HostRuntimesClient,
  type SkillsRuntimeBroker,
  type SkillsRuntimeResolveError as RuntimeResolveError,
} from '../api/runtime-adapter';

export type CreateSkillsWireControllerOptions = Readonly<{
  runtimes: SkillsRuntimeBroker;
}>;

export function createSkillsWireController(options: CreateSkillsWireControllerOptions): Controller {
  return createController(skillsContract, {
    installed: createInstalledModelProvider(options.runtimes),
    install: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.installSkill(withoutHost(input), callOptions(meta))
      ),
    remove: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.removeSkill(withoutHost(input), callOptions(meta))
      ),
    create: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.createSkill(withoutHost(input), callOptions(meta))
      ),
  });
}

function createInstalledModelProvider(
  runtimes: SkillsRuntimeBroker
): LeasedLiveModelProvider<typeof skillsContract.installed> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: skillsContract.installed,
    acquireState: (key, name) =>
      acquireRuntimeSource(runtimes, key.host, (runtime) =>
        runtime.agentConfig.skills.state(undefined, name).asLiveSource()
      ),
    async runMutation() {
      throw new Error(`Live model '${skillsContract.installed.id}' has no mutations`);
    },
    async dispose() {},
  };
}

async function withAgentConfigResult<T, E>(
  runtimes: SkillsRuntimeBroker,
  host: HostRef,
  work: (client: HostRuntimesClient['agentConfig']) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const lease = runtimes.session(host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) return err(runtime.error);
    return await work(runtime.data.agentConfig);
  } finally {
    await lease.release();
  }
}

function acquireRuntimeSource(
  runtimes: SkillsRuntimeBroker,
  host: HostRef,
  source: (client: HostRuntimesClient) => LiveSource
): PendingLease<LiveSource> {
  const lease = runtimes.session(host);
  const ready = lease.ready();
  return {
    async ready() {
      const runtime = await ready;
      if (!runtime.success) throwSkillsRuntimeResolveError(runtime.error);
      return source(runtime.data);
    },
    release: () => lease.release(),
  };
}

function withoutHost<T extends { host: HostRef }>(input: T): Omit<T, 'host'> {
  const { host: _, ...rest } = input;
  return rest;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}
