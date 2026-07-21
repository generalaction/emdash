import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '@emdash/core/primitives/concurrency/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import type { Unsubscribe } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { upsertRunProjection } from '@core/features/automations/api/node/run-projection';
import type {
  Automation,
  CreateAutomationParams,
  UpdateAutomationPatch,
} from '@core/primitives/automations/api';
import { getLocalTimeZone } from '@core/primitives/automations/api';
import { assertValidCronTrigger } from '@core/primitives/automations/api';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import type { AppDb } from '@core/services/app-db/node/db';
import type { buildAutomationDeployment } from '../../node/deployment-builder';
import {
  deleteAutomationDefinition,
  getAutomation,
  insertAutomation,
  listAutomations as listAutomationDefinitions,
  projectExists,
  replaceAutomation,
  setAutomationRevision,
} from '../../node/repo';
import {
  getAutomationRuntimeAvailability,
  resolveAutomationRuntime,
  resolveLocalAutomationRuntime,
  type AutomationRuntimeDependencies,
  type AutomationRuntimeTarget,
} from '../../node/runtime-client-resolver';

export type AutomationsServiceHooks = {
  'automation:created': (automation: Automation) => void | Promise<void>;
  'automation:updated': (automation: Automation) => void | Promise<void>;
  'automation:enabled': (automation: Automation) => void | Promise<void>;
  'automation:deleted': (id: string) => void | Promise<void>;
  'run:step-completed': (run: AutomationRun) => void | Promise<void>;
};

export class AutomationsService implements Hookable<AutomationsServiceHooks> {
  private readonly hooks = new HookCore<AutomationsServiceHooks>((name, error) =>
    log.error(`AutomationsService: ${String(name)} hook error`, { error })
  );
  private readonly definitionMutationMutex = new KeyedMutex();
  private runEventsUnsubscribe: Unsubscribe | undefined;
  private initializationPromise: Promise<void> | undefined;

  constructor(
    private readonly dependencies: {
      buildDeployment(automation: Automation): ReturnType<typeof buildAutomationDeployment>;
      db: AppDb;
      runtime: AutomationRuntimeDependencies;
    }
  ) {}

  on<K extends keyof AutomationsServiceHooks>(name: K, handler: AutomationsServiceHooks[K]) {
    return this.hooks.on(name, handler);
  }

  initialize(): Promise<void> {
    this.initializationPromise ??= this.initializeOnce();
    return this.initializationPromise;
  }

  stop(): void {
    this.runEventsUnsubscribe?.();
    this.runEventsUnsubscribe = undefined;
  }

  list(projectId?: string): Promise<Automation[]> {
    return listAutomationDefinitions(this.dependencies.db, projectId);
  }

  getTargetAvailability(projectId?: string) {
    return getAutomationRuntimeAvailability(this.dependencies.runtime, projectId);
  }

  async create(params: CreateAutomationParams): Promise<Automation> {
    if (!(await projectExists(this.dependencies.db, params.projectId))) {
      throw new Error('project_not_found');
    }
    const now = Date.now();
    const automation = normalizeDefinition({
      id: randomUUID(),
      projectId: params.projectId,
      name: validateName(params.name),
      triggerConfig: params.triggerConfig,
      conversationConfig: params.conversationConfig,
      taskConfig: params.taskConfig,
      enabled: params.enabled !== false,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    validateDefinition(automation);

    const target = await this.deploy(automation);
    try {
      const inserted = await insertAutomation(this.dependencies.db, automation);
      this.hooks.callHookBackground('automation:created', inserted);
      return inserted;
    } catch (error) {
      await this.removeFromRuntime(target, automation.id, true);
      throw error;
    }
  }

  update(id: string, patch: UpdateAutomationPatch): Promise<Automation> {
    return this.definitionMutationMutex.runExclusive(id, async () => {
      const existing = await this.requireAutomation(id);
      if (
        patch.projectId !== undefined &&
        !(await projectExists(this.dependencies.db, patch.projectId))
      ) {
        throw new Error('project_not_found');
      }
      const updated = normalizeDefinition({
        ...existing,
        name: patch.name === undefined ? existing.name : validateName(patch.name),
        enabled: patch.enabled ?? existing.enabled,
        projectId: patch.projectId ?? existing.projectId,
        triggerConfig: patch.triggerConfig ?? existing.triggerConfig,
        conversationConfig: patch.conversationConfig ?? existing.conversationConfig,
        taskConfig:
          patch.taskConfig === null ? undefined : (patch.taskConfig ?? existing.taskConfig),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      });
      const hook =
        patch.enabled !== undefined && patch.enabled !== existing.enabled
          ? 'automation:enabled'
          : 'automation:updated';
      return this.replaceDeployedDefinition(existing, updated, hook);
    });
  }

  delete(id: string): Promise<void> {
    return this.definitionMutationMutex.runExclusive(id, async () => {
      const automation = await this.requireAutomation(id);
      const target = automation.projectId
        ? await resolveAutomationRuntime(this.dependencies.runtime, automation.projectId)
        : await resolveLocalAutomationRuntime(this.dependencies.runtime);
      await this.removeFromRuntime(target, id, true);
      try {
        if (!(await deleteAutomationDefinition(this.dependencies.db, id))) {
          throw new Error('automation_not_found');
        }
      } catch (error) {
        await this.restoreDeploymentAfterFailure(automation, target, 'desktop deletion');
        throw error;
      }
      this.hooks.callHookBackground('automation:deleted', id);
    });
  }

  async removeProjectDeployments(projectId: string): Promise<void> {
    const definitions = await listAutomationDefinitions(this.dependencies.db, projectId);
    if (definitions.length === 0) return;
    const target = await resolveLocalAutomationRuntime(this.dependencies.runtime);
    await Promise.all(
      definitions.map((automation) =>
        this.definitionMutationMutex.runExclusive(automation.id, async () => {
          const current = await getAutomation(this.dependencies.db, automation.id);
          if (!current || current.projectId !== projectId) return;
          await this.removeFromRuntime(target, current.id, true);
        })
      )
    );
  }

  private async initializeOnce(): Promise<void> {
    const target = await resolveLocalAutomationRuntime(this.dependencies.runtime);
    this.runEventsUnsubscribe = await target.client.runEvents.subscribe(
      {},
      {
        onEvent: ({ run }) => this.handleRunEvent(run),
        onGap: () => {},
        onError: (error, { retrying }) => {
          if (!retrying) log.warn('Automation telemetry event stream disconnected', { error });
        },
      }
    );
    await this.migrateDefinitions();
  }

  private async migrateDefinitions(): Promise<void> {
    await this.removeOrphanedLocalDeployments();
    const definitions = await listAutomationDefinitions(this.dependencies.db);
    for (const automation of definitions) {
      const availability = await getAutomationRuntimeAvailability(
        this.dependencies.runtime,
        automation.projectId
      );
      if (!availability.available) continue;
      try {
        const normalized = normalizeDefinition(automation);
        if (normalized === automation) {
          await this.deploy(automation);
          continue;
        }
        const migrated = {
          ...normalized,
          revision: automation.revision + 1,
          updatedAt: Date.now(),
        };
        await this.deploy(migrated);
        if (!(await replaceAutomation(this.dependencies.db, migrated))) {
          throw new Error('automation_not_found');
        }
      } catch (error) {
        log.warn('Failed to deploy an automation definition to the core runtime', {
          automationId: automation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async removeOrphanedLocalDeployments(): Promise<void> {
    try {
      const definitions = (await listAutomationDefinitions(this.dependencies.db)).filter(
        (automation) => !automation.projectId
      );
      if (definitions.length === 0) return;
      const target = await resolveLocalAutomationRuntime(this.dependencies.runtime);
      for (const automation of definitions) {
        await this.definitionMutationMutex.runExclusive(automation.id, async () => {
          const current = await getAutomation(this.dependencies.db, automation.id);
          if (!current || current.projectId) return;
          await this.removeFromRuntime(target, current.id, true);
        });
      }
    } catch (error) {
      log.warn('Failed to remove local deployments whose project was deleted', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async replaceDeployedDefinition(
    existing: Automation,
    updated: Automation,
    hook: 'automation:updated' | 'automation:enabled'
  ): Promise<Automation> {
    validateDefinition(updated);
    const currentTarget = await resolveAutomationRuntime(
      this.dependencies.runtime,
      existing.projectId
    );
    const nextTarget = await this.deploy(updated);

    try {
      if (currentTarget.key !== nextTarget.key) {
        await this.removeFromRuntime(currentTarget, existing.id, true);
      }
      const saved = await replaceAutomation(this.dependencies.db, updated);
      if (!saved) throw new Error('automation_conflict');
      this.hooks.callHookBackground(hook, saved);
      return saved;
    } catch (error) {
      await this.restoreDeploymentAfterFailure(existing, currentTarget, 'desktop update');
      if (currentTarget.key !== nextTarget.key) {
        await this.removeFromRuntime(nextTarget, updated.id, true).catch((rollbackError) => {
          log.error('Failed to remove the new automation target after a desktop DB error', {
            automationId: existing.id,
            rollbackError,
          });
        });
      }
      throw error;
    }
  }

  private async restoreDeploymentAfterFailure(
    automation: Automation,
    target: AutomationRuntimeTarget,
    operation: string
  ): Promise<void> {
    const rollback = { ...automation, revision: automation.revision + 2 };
    try {
      await this.deployToTarget(rollback, target);
      if (!(await setAutomationRevision(this.dependencies.db, automation.id, rollback.revision))) {
        throw new Error('automation_not_found');
      }
    } catch (rollbackError) {
      log.error(`Failed to restore an automation after its ${operation} failed`, {
        automationId: automation.id,
        rollbackError,
      });
    }
  }

  private async deploy(automation: Automation): Promise<AutomationRuntimeTarget> {
    validateDefinition(automation);
    const target = await resolveAutomationRuntime(this.dependencies.runtime, automation.projectId);
    await this.deployToTarget(automation, target);
    return target;
  }

  private async deployToTarget(
    automation: Automation,
    target: AutomationRuntimeTarget
  ): Promise<void> {
    const deployment = await this.dependencies.buildDeployment(automation);
    const result = await target.client.deploy(deployment);
    if (!result.success) throw new Error(result.error.message);
    if (result.data.deployment.revision !== deployment.revision) {
      throw new Error('automation_deployment_stale');
    }
  }

  private async removeFromRuntime(
    target: AutomationRuntimeTarget,
    automationId: string,
    allowMissing: boolean
  ): Promise<void> {
    const result = await target.client.remove({ automationId });
    if (result.success || (allowMissing && result.error.type === 'automation-not-found')) return;
    throw new Error(result.error.message);
  }

  private handleRunEvent(run: AutomationRun): void {
    void upsertRunProjection(this.dependencies.db, run).catch((error) => {
      log.warn('Failed to update the automation run projection', {
        automationId: run.automationId,
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.hooks.callHookBackground('run:step-completed', run);
  }

  private async requireAutomation(id: string): Promise<Automation> {
    const automation = await getAutomation(this.dependencies.db, id);
    if (!automation) throw new Error('automation_not_found');
    return automation;
  }
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('name_required');
  return trimmed;
}

function normalizeDefinition(automation: Automation): Automation {
  if (!automation.triggerConfig || automation.triggerConfig.tz?.trim()) return automation;
  return {
    ...automation,
    triggerConfig: { ...automation.triggerConfig, tz: getLocalTimeZone() },
  };
}

function validateDefinition(automation: Automation): void {
  validateName(automation.name);
  if (!automation.triggerConfig || !automation.conversationConfig || !automation.taskConfig) {
    throw new Error('automation_not_configured');
  }
  assertValidCronTrigger(automation.triggerConfig);
  if (!automation.conversationConfig.prompt.trim()) {
    throw new Error('conversation_config_prompt_required');
  }
}
