import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '@emdash/core/primitives/concurrency/api';
import { hostRefKey, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { upsertRunProjection } from '@core/features/automations/api/node/run-projection';
import type {
  Automation,
  AutomationDefinitionError,
  CreateAutomationParams,
  InvalidAutomationDefinitionReason,
  UpdateAutomationPatch,
} from '@core/primitives/automations/api';
import { assertValidCronTrigger, getLocalTimeZone } from '@core/primitives/automations/api';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import { projectHostRef } from '@core/primitives/projects/api';
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
  resolveAutomationRuntimeClient,
  type AutomationRuntimeDependencies,
} from '../../node/runtime-client-resolver';

type AutomationRuntimeClient = HostRuntimesClient['automations'];
type DefinitionResult<T> = Result<T, AutomationDefinitionError>;

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

  async create(params: CreateAutomationParams): Promise<DefinitionResult<Automation>> {
    try {
      if (!(await projectExists(this.dependencies.db, params.projectId))) {
        return err(projectNotFound(params.projectId));
      }
      const name = validateName(params.name);
      if (!name.success) return name;
      const now = Date.now();
      const automation = normalizeDefinition({
        id: randomUUID(),
        projectId: params.projectId,
        name: name.data,
        triggerConfig: params.triggerConfig,
        conversationConfig: params.conversationConfig,
        taskConfig: params.taskConfig,
        enabled: params.enabled !== false,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      const valid = validateDefinition(automation);
      if (!valid.success) return valid;

      const client = await resolveAutomationRuntimeClient(
        this.dependencies.runtime,
        automation.projectId
      );
      const deployed = await this.deployToTarget(automation, client.automations);
      if (!deployed.success) return deployed;
      try {
        const inserted = await insertAutomation(this.dependencies.db, automation);
        this.hooks.callHookBackground('automation:created', inserted);
        return ok(inserted);
      } catch (error) {
        const rollback = await this.removeFromRuntime(client.automations, automation.id, true);
        if (!rollback.success) {
          log.error('Failed to remove an automation after its desktop insert failed', {
            automationId: automation.id,
            rollbackError: rollback.error,
          });
        }
        return err(runtimeUnavailable(error));
      }
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }

  async update(id: string, patch: UpdateAutomationPatch): Promise<DefinitionResult<Automation>> {
    try {
      return await this.definitionMutationMutex.runExclusive(id, async () => {
        const existing = await this.requireAutomation(id);
        if (!existing.success) return existing;
        if (
          patch.projectId !== undefined &&
          !(await projectExists(this.dependencies.db, patch.projectId))
        ) {
          return err(projectNotFound(patch.projectId));
        }
        const name = patch.name === undefined ? ok(existing.data.name) : validateName(patch.name);
        if (!name.success) return name;
        const updated = normalizeDefinition({
          ...existing.data,
          name: name.data,
          enabled: patch.enabled ?? existing.data.enabled,
          projectId: patch.projectId ?? existing.data.projectId,
          triggerConfig: patch.triggerConfig ?? existing.data.triggerConfig,
          conversationConfig: patch.conversationConfig ?? existing.data.conversationConfig,
          taskConfig:
            patch.taskConfig === null ? undefined : (patch.taskConfig ?? existing.data.taskConfig),
          revision: existing.data.revision + 1,
          updatedAt: Date.now(),
        });
        const hook =
          patch.enabled !== undefined && patch.enabled !== existing.data.enabled
            ? 'automation:enabled'
            : 'automation:updated';
        return this.replaceDeployedDefinition(existing.data, updated, hook);
      });
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }

  async delete(id: string): Promise<DefinitionResult<void>> {
    try {
      return await this.definitionMutationMutex.runExclusive(id, async () => {
        const automation = await this.requireAutomation(id);
        if (!automation.success) return automation;
        const client = await resolveAutomationRuntimeClient(
          this.dependencies.runtime,
          automation.data.projectId
        );
        const removed = await this.removeFromRuntime(client.automations, id, true);
        if (!removed.success) return removed;
        try {
          if (!(await deleteAutomationDefinition(this.dependencies.db, id))) {
            await this.restoreDeploymentAfterFailure(
              automation.data,
              client.automations,
              'desktop deletion'
            );
            return err(automationNotFound(id));
          }
        } catch (error) {
          await this.restoreDeploymentAfterFailure(
            automation.data,
            client.automations,
            'desktop deletion'
          );
          return err(runtimeUnavailable(error));
        }
        this.hooks.callHookBackground('automation:deleted', id);
        return ok();
      });
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }

  async removeProjectDeployments(projectId: string): Promise<void> {
    const definitions = await listAutomationDefinitions(this.dependencies.db, projectId);
    if (definitions.length === 0) return;
    const client = await resolveAutomationRuntimeClient(this.dependencies.runtime, projectId);
    await Promise.all(
      definitions.map((automation) =>
        this.definitionMutationMutex.runExclusive(automation.id, async () => {
          const current = await getAutomation(this.dependencies.db, automation.id);
          if (!current || current.projectId !== projectId) return;
          const removed = await this.removeFromRuntime(client.automations, current.id, true);
          if (!removed.success) throw new Error(removed.error.message);
        })
      )
    );
  }

  private async initializeOnce(): Promise<void> {
    const client = await resolveAutomationRuntimeClient(this.dependencies.runtime);
    this.runEventsUnsubscribe = await client.automations.runEvents.subscribe(
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
      const normalized = normalizeDefinition(automation);
      const migrated =
        normalized === automation
          ? automation
          : { ...normalized, revision: automation.revision + 1, updatedAt: Date.now() };
      const deployed = await this.deployToRuntime(migrated);
      if (!deployed.success) {
        this.logMigrationFailure(automation.id, deployed.error);
        continue;
      }
      if (normalized === automation) continue;
      try {
        if (!(await replaceAutomation(this.dependencies.db, migrated))) {
          this.logMigrationFailure(automation.id, automationNotFound(automation.id));
        }
      } catch (error) {
        this.logMigrationFailure(automation.id, runtimeUnavailable(error));
      }
    }
  }

  private logMigrationFailure(automationId: string, error: AutomationDefinitionError): void {
    log.warn('Failed to deploy an automation definition to the core runtime', {
      automationId,
      error: error.message,
    });
  }

  private async removeOrphanedLocalDeployments(): Promise<void> {
    try {
      const definitions = (await listAutomationDefinitions(this.dependencies.db)).filter(
        (automation) => !automation.projectId
      );
      if (definitions.length === 0) return;
      const client = await resolveAutomationRuntimeClient(this.dependencies.runtime);
      for (const automation of definitions) {
        await this.definitionMutationMutex.runExclusive(automation.id, async () => {
          const current = await getAutomation(this.dependencies.db, automation.id);
          if (!current || current.projectId) return;
          const removed = await this.removeFromRuntime(client.automations, current.id, true);
          if (!removed.success) {
            log.warn('Failed to remove a local automation deployment', {
              automationId: current.id,
              error: removed.error.message,
            });
          }
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
  ): Promise<DefinitionResult<Automation>> {
    const valid = validateDefinition(updated);
    if (!valid.success) return valid;
    const [currentTarget, nextTarget] = await Promise.all([
      this.runtimeTargetKey(existing.projectId),
      this.runtimeTargetKey(updated.projectId),
    ]);
    if (!currentTarget.success) return currentTarget;
    if (!nextTarget.success) return nextTarget;

    try {
      const [currentRuntime, nextRuntime] = await Promise.all([
        resolveAutomationRuntimeClient(this.dependencies.runtime, existing.projectId),
        resolveAutomationRuntimeClient(this.dependencies.runtime, updated.projectId),
      ]);
      const currentClient = currentRuntime.automations;
      const nextClient = nextRuntime.automations;
      const deployed = await this.deployToTarget(updated, nextClient);
      if (!deployed.success) return deployed;

      let failure: AutomationDefinitionError | undefined;
      if (currentTarget.data !== nextTarget.data) {
        const removed = await this.removeFromRuntime(currentClient, existing.id, true);
        if (!removed.success) failure = removed.error;
      }

      let saved: Automation | null = null;
      if (!failure) {
        try {
          saved = await replaceAutomation(this.dependencies.db, updated);
          if (!saved) failure = automationConflict(existing.id);
        } catch (error) {
          failure = runtimeUnavailable(error);
        }
      }

      if (failure) {
        await this.restoreDeploymentAfterFailure(existing, currentClient, 'desktop update');
        if (currentTarget.data !== nextTarget.data) {
          const rollback = await this.removeFromRuntime(nextClient, updated.id, true);
          if (!rollback.success) {
            log.error('Failed to remove the new automation target after a desktop DB error', {
              automationId: existing.id,
              rollbackError: rollback.error,
            });
          }
        }
        return err(failure);
      }

      if (!saved) return err(automationConflict(existing.id));
      this.hooks.callHookBackground(hook, saved);
      return ok(saved);
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }

  private async restoreDeploymentAfterFailure(
    automation: Automation,
    client: AutomationRuntimeClient,
    operation: string
  ): Promise<void> {
    const rollback = { ...automation, revision: automation.revision + 2 };
    const deployed = await this.deployToTarget(rollback, client);
    if (!deployed.success) {
      this.logRollbackFailure(automation.id, operation, deployed.error);
      return;
    }
    try {
      if (!(await setAutomationRevision(this.dependencies.db, automation.id, rollback.revision))) {
        this.logRollbackFailure(automation.id, operation, automationNotFound(automation.id));
      }
    } catch (error) {
      this.logRollbackFailure(automation.id, operation, runtimeUnavailable(error));
    }
  }

  private logRollbackFailure(
    automationId: string,
    operation: string,
    rollbackError: AutomationDefinitionError
  ): void {
    log.error(`Failed to restore an automation after its ${operation} failed`, {
      automationId,
      rollbackError,
    });
  }

  private async deployToRuntime(automation: Automation): Promise<DefinitionResult<void>> {
    const valid = validateDefinition(automation);
    if (!valid.success) return valid;
    try {
      const client = await resolveAutomationRuntimeClient(
        this.dependencies.runtime,
        automation.projectId
      );
      return await this.deployToTarget(automation, client.automations);
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }

  private async deployToTarget(
    automation: Automation,
    client: AutomationRuntimeClient
  ): Promise<DefinitionResult<void>> {
    let deployment: Awaited<ReturnType<typeof buildAutomationDeployment>>;
    try {
      deployment = await this.dependencies.buildDeployment(automation);
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
    if (!deployment.success) return deployment;
    try {
      const result = await client.deploy(deployment.data);
      if (!result.success) return err(runtimeUnavailable(result.error));
      if (result.data.deployment.revision !== deployment.data.revision) {
        return err({
          type: 'deployment-stale',
          automationId: automation.id,
          expectedRevision: deployment.data.revision,
          actualRevision: result.data.deployment.revision,
          message: 'This automation changed on its runtime. Try saving again.',
        });
      }
      return ok();
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }

  private async removeFromRuntime(
    client: AutomationRuntimeClient,
    automationId: string,
    allowMissing: boolean
  ): Promise<DefinitionResult<void>> {
    try {
      const result = await client.remove({ automationId });
      if (result.success || (allowMissing && result.error.type === 'automation-not-found')) {
        return ok();
      }
      return err(runtimeUnavailable(result.error));
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
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

  private async requireAutomation(id: string): Promise<DefinitionResult<Automation>> {
    const automation = await getAutomation(this.dependencies.db, id);
    return automation ? ok(automation) : err(automationNotFound(id));
  }

  private async runtimeTargetKey(projectId: string | undefined): Promise<DefinitionResult<string>> {
    if (!projectId) return ok(hostRefKey(LOCAL_HOST_REF));
    try {
      const project = await this.dependencies.runtime.getProjectById(projectId);
      return project ? ok(hostRefKey(projectHostRef(project))) : err(projectNotFound(projectId));
    } catch (error) {
      return err(runtimeUnavailable(error));
    }
  }
}

function validateName(name: string): DefinitionResult<string> {
  const trimmed = name.trim();
  return trimmed ? ok(trimmed) : err(invalidDefinition('name_required'));
}

function normalizeDefinition(automation: Automation): Automation {
  if (!automation.triggerConfig || automation.triggerConfig.tz?.trim()) return automation;
  return {
    ...automation,
    triggerConfig: { ...automation.triggerConfig, tz: getLocalTimeZone() },
  };
}

function validateDefinition(automation: Automation): DefinitionResult<void> {
  const name = validateName(automation.name);
  if (!name.success) return name;
  if (!automation.triggerConfig || !automation.conversationConfig || !automation.taskConfig) {
    return err(invalidDefinition('automation_not_configured'));
  }
  try {
    assertValidCronTrigger(automation.triggerConfig);
  } catch {
    return err(invalidDefinition('cron_invalid'));
  }
  if (!automation.conversationConfig.prompt.trim()) {
    return err(invalidDefinition('conversation_config_prompt_required'));
  }
  return ok();
}

function invalidDefinition(reason: InvalidAutomationDefinitionReason): AutomationDefinitionError {
  const messages: Record<InvalidAutomationDefinitionReason, string> = {
    name_required: 'Give the automation a name.',
    automation_not_configured: 'Finish configuring the automation before saving.',
    conversation_config_prompt_required: 'Add a prompt before saving.',
    cron_invalid: 'Enter a valid schedule.',
  };
  return { type: 'invalid-definition', reason, message: messages[reason] };
}

function projectNotFound(projectId: string): AutomationDefinitionError {
  return {
    type: 'project-not-found',
    projectId,
    message: 'The selected project no longer exists.',
  };
}

function automationNotFound(automationId: string): AutomationDefinitionError {
  return {
    type: 'automation-not-found',
    automationId,
    message: 'This automation no longer exists.',
  };
}

function automationConflict(automationId: string): AutomationDefinitionError {
  return {
    type: 'automation-conflict',
    automationId,
    message: 'This automation changed while it was being saved. Try again.',
  };
}

function runtimeUnavailable(error: unknown): AutomationDefinitionError {
  return {
    type: 'runtime-unavailable',
    message:
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error),
  };
}
