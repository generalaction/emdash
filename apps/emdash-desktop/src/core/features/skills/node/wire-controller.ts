import type { HostRef } from '@emdash/core/primitives/host/api';
import { err, type Result } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire';
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
): LiveModelProvider<typeof skillsContract.installed> {
  return {
    kind: 'liveModelProvider',
    contract: skillsContract.installed,
    resolveState: (key, name) =>
      resolveRuntimeSource(runtimes, key.host, (runtime) =>
        runtime.agentConfig.skills.state(undefined, name).asLiveSource()
      ),
    async runMutation() {
      throw new Error(`Live model '${skillsContract.installed.id}' has no mutations`);
    },
  };
}

async function withAgentConfigResult<T, E>(
  runtimes: SkillsRuntimeBroker,
  host: HostRef,
  work: (client: HostRuntimesClient['agentConfig']) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const runtime = await runtimes.client(host);
  if (!runtime.success) return err(runtime.error);
  return await work(runtime.data.agentConfig);
}

async function resolveRuntimeSource(
  runtimes: SkillsRuntimeBroker,
  host: HostRef,
  source: (client: HostRuntimesClient) => LiveSource
): Promise<LiveSource> {
  const runtime = await runtimes.client(host);
  if (!runtime.success) throwSkillsRuntimeResolveError(runtime.error);
  return source(runtime.data);
}

function withoutHost<T extends { host: HostRef }>(input: T): Omit<T, 'host'> {
  const { host: _, ...rest } = input;
  return rest;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}
