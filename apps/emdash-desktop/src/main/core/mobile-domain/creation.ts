import { randomUUID } from 'node:crypto';
import type { MobileCreationOptions } from '@emdash/core/mobile-access';
import type { MobileAccessError } from '@emdash/core/mobile-access';
import { asAgentProviderId } from '@emdash/plugins/agents/types';
import { ok, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { buildAgentPayloads } from '@main/core/agents/agent-payload-builder';
import { createConversation } from '@main/core/conversations/createConversation';
import {
  ensureAgentDependenciesProbed,
  getDependencyManager,
} from '@main/core/dependencies/dependency-managers';
import { appSettingsService } from '@main/core/settings/settings-service';
import { createTerminal } from '@main/core/terminals/createTerminal';
import { getTerminalShellAvailability } from '@main/core/terminals/getTerminalShellAvailability';
import { db } from '@main/db/client';
import { conversations, terminals } from '@main/db/schema';
import type { TerminalShellId } from '@shared/core/terminals/terminal-settings';
import { mobileError, toMobileError } from './errors';
import { getReadyTaskContext } from './task-context';

const taskQueues = new Map<string, Promise<void>>();

export async function getMobileCreationOptions(
  taskId: string
): Promise<Result<MobileCreationOptions, MobileAccessError>> {
  try {
    const { persistData } = await getReadyTaskContext(taskId);
    const connectionId = persistData?.sshConnectionId;
    const manager = await getDependencyManager(connectionId);
    await ensureAgentDependenciesProbed(manager);
    const payloads = await buildAgentPayloads(manager.platform, manager);
    const available = payloads.filter((agent) => agent.status === 'available');
    const [defaultAgentId, taskSettings, terminalSettings, shellAvailability] = await Promise.all([
      appSettingsService.get('defaultAgent'),
      appSettingsService.get('tasks'),
      appSettingsService.get('terminal'),
      getTerminalShellAvailability(
        connectionId ? { kind: 'ssh', connectionId } : { kind: 'local' }
      ),
    ]);
    const agents = available.map((agent) => ({
      id: agent.id,
      name: agent.name,
      supportsAcp: agent.capabilities.acp.kind === 'supported',
      supportsPty: agent.capabilities.prompt.kind !== 'none',
      supportsAutoApprove: agent.capabilities.autoApprove.kind === 'supported',
      models:
        agent.capabilities.models.kind === 'selectable'
          ? Object.entries(agent.capabilities.models.modelOptions).map(([id, model]) => ({
              id,
              name: model.name,
            }))
          : [],
    }));
    return ok({
      defaultAgentId: agents.some((agent) => agent.id === defaultAgentId)
        ? defaultAgentId
        : (agents[0]?.id ?? null),
      agents,
      defaultShellId: connectionId ? 'system' : terminalSettings.defaultShell,
      shells: shellAvailability.map((shell) => ({
        id: shell.id,
        name: shell.label,
        available: shell.available,
      })),
      autoApproveByDefault: taskSettings.autoApproveByDefault,
    });
  } catch (error) {
    return { success: false, error: toMobileError(error) };
  }
}

export async function createMobileAgent(input: {
  taskId: string;
  interface: 'acp' | 'pty';
  providerId: string;
  model?: string | null;
  autoApprove?: boolean;
}): Promise<Result<{ id: string; type: 'acp' | 'pty' }, MobileAccessError>> {
  return await serializeForTask(input.taskId, async () => {
    try {
      const { task } = await getReadyTaskContext(input.taskId);
      const optionsResult = await getMobileCreationOptions(input.taskId);
      if (!optionsResult.success) return optionsResult;
      const agent = optionsResult.data.agents.find(
        (candidate) => candidate.id === input.providerId
      );
      if (!agent) return mobileError('not_available', 'The selected agent is not available');
      if (input.interface === 'acp' && !agent.supportsAcp) {
        return mobileError('not_supported', 'The selected agent does not support chat UI');
      }
      if (input.interface === 'pty' && !agent.supportsPty) {
        return mobileError('not_supported', 'The selected agent does not support a terminal UI');
      }
      if (input.model && !agent.models.some((model) => model.id === input.model)) {
        return mobileError('invalid_request', 'The selected model is not available for this agent');
      }
      if (input.interface === 'acp' && input.autoApprove !== undefined) {
        return mobileError('not_supported', 'Auto-approve is configured by the live ACP session');
      }
      if (input.autoApprove && !agent.supportsAutoApprove) {
        return mobileError('not_supported', 'The selected agent does not support auto-approve');
      }

      const existing = await db
        .select({ title: conversations.title })
        .from(conversations)
        .where(eq(conversations.taskId, input.taskId));
      const title = nextNumberedName(
        capitalize(input.providerId),
        existing.map((row) => row.title)
      );
      const conversation = await createConversation({
        id: randomUUID(),
        projectId: task.projectId,
        taskId: task.id,
        provider: asAgentProviderId(input.providerId),
        title,
        type: input.interface === 'acp' ? 'acp' : 'pty',
        ...(input.model ? { model: input.model } : {}),
        ...(input.interface === 'pty'
          ? {
              autoApprove: input.autoApprove ?? optionsResult.data.autoApproveByDefault,
              initialSize: { cols: 80, rows: 24 },
            }
          : {}),
      });
      return ok({ id: conversation.id, type: input.interface === 'acp' ? 'acp' : 'pty' });
    } catch (error) {
      return { success: false as const, error: toMobileError(error) };
    }
  });
}

export async function createMobileTerminal(input: {
  taskId: string;
  shellId?: string;
}): Promise<Result<{ id: string }, MobileAccessError>> {
  return await serializeForTask(input.taskId, async () => {
    try {
      const { task } = await getReadyTaskContext(input.taskId);
      const optionsResult = await getMobileCreationOptions(input.taskId);
      if (!optionsResult.success) return optionsResult;
      const shellId = input.shellId ?? optionsResult.data.defaultShellId;
      const shell = optionsResult.data.shells.find((candidate) => candidate.id === shellId);
      if (!shell?.available)
        return mobileError('not_available', 'The selected shell is unavailable');

      const existing = await db
        .select({ name: terminals.name })
        .from(terminals)
        .where(eq(terminals.taskId, input.taskId));
      const terminal = await createTerminal({
        id: randomUUID(),
        projectId: task.projectId,
        taskId: task.id,
        name: nextNumberedName(
          'Terminal',
          existing.map((row) => row.name)
        ),
        shell: shellId as TerminalShellId,
        initialSize: { cols: 80, rows: 24 },
      });
      return ok({ id: terminal.id });
    } catch (error) {
      return { success: false as const, error: toMobileError(error) };
    }
  });
}

function nextNumberedName(base: string, names: string[]): string {
  const used = new Set<number>();
  const pattern = new RegExp(`^${escapeRegExp(base)} \\((\\d+)\\)$`, 'i');
  for (const name of names) {
    const match = pattern.exec(name.trim());
    if (match?.[1]) used.add(Number(match[1]));
  }
  let number = 1;
  while (used.has(number)) number += 1;
  return `${base} (${number})`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function serializeForTask<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
  const previous = taskQueues.get(taskId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  taskQueues.set(taskId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (taskQueues.get(taskId) === queued) taskQueues.delete(taskId);
  }
}
