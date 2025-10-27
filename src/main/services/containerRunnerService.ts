import { EventEmitter } from 'node:events';

import type { ResolvedContainerConfig } from '@shared/container';
import {
  generateMockStartEvents,
  PortAllocationError,
  PortManager,
  type RunnerEvent,
  type RunnerErrorEvent,
  type RunnerMode,
} from '@shared/container';

import { log } from '../lib/logger';
import {
  ContainerConfigLoadError,
  ContainerConfigLoadResult,
  loadWorkspaceContainerConfig,
} from './containerConfigService';

const RUN_EVENT_CHANNEL = 'runner-event';

export type ContainerStartErrorCode =
  | 'INVALID_ARGUMENT'
  | ContainerConfigLoadError['code']
  | 'PORT_ALLOC_FAILED'
  | 'UNKNOWN';

export interface ContainerStartError {
  code: ContainerStartErrorCode;
  message: string;
  configPath: string | null;
  configKey: string | null;
}

export interface ContainerStartOptions {
  workspaceId: string;
  workspacePath: string;
  runId?: string;
  mode?: RunnerMode;
  now?: () => number;
}

export interface ContainerStartSuccess {
  ok: true;
  runId: string;
  config: ResolvedContainerConfig;
  sourcePath: string | null;
}

export interface ContainerStartFailure {
  ok: false;
  error: ContainerStartError;
}

export type ContainerStartResult = ContainerStartSuccess | ContainerStartFailure;

export interface ContainerRunnerServiceOptions {
  portAllocator?: Pick<PortManager, 'allocate'>;
}

export class ContainerRunnerService extends EventEmitter {
  private readonly portAllocator: Pick<PortManager, 'allocate'>;

  constructor(options: ContainerRunnerServiceOptions = {}) {
    super();
    this.portAllocator = options.portAllocator ?? new PortManager();
  }

  onRunnerEvent(listener: (event: RunnerEvent) => void): this {
    this.on(RUN_EVENT_CHANNEL, listener);
    return this;
  }

  offRunnerEvent(listener: (event: RunnerEvent) => void): this {
    this.off(RUN_EVENT_CHANNEL, listener);
    return this;
  }

  emitRunnerEvent(event: RunnerEvent): boolean {
    return this.emit(RUN_EVENT_CHANNEL, event);
  }

  async startMockRun(options: ContainerStartOptions): Promise<ContainerStartResult> {
    const { workspaceId, workspacePath } = options;
    if (!workspaceId || !workspacePath) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: '`workspaceId` and `workspacePath` are required',
          configKey: null,
          configPath: null,
        },
      };
    }

    const loadResult = await this.loadConfig(workspacePath);
    if (loadResult.ok === false) {
      return {
        ok: false,
        error: this.serializeConfigError(loadResult.error),
      };
    }

    const now = options.now ?? Date.now;
    const runId = options.runId ?? this.generateRunId(now);
    const mode = options.mode ?? 'container';

    try {
      const events = await generateMockStartEvents({
        workspaceId,
        config: loadResult.config,
        portAllocator: this.portAllocator,
        runId,
        mode,
        now,
      });

      for (const event of events) {
        this.emitRunnerEvent(event);
      }

      return {
        ok: true,
        runId,
        config: loadResult.config,
        sourcePath: loadResult.sourcePath ?? null,
      };
    } catch (error) {
      log.error('container runner start failed', error);
      const serialized = this.serializeStartError(error, {
        workspaceId,
        runId,
        mode,
        now,
      });
      if (serialized.event) {
        this.emitRunnerEvent(serialized.event);
      }
      return {
        ok: false,
        error: serialized.error,
      };
    }
  }

  private async loadConfig(workspacePath: string): Promise<ContainerConfigLoadResult> {
    return loadWorkspaceContainerConfig(workspacePath);
  }

  private serializeConfigError(error: ContainerConfigLoadError): ContainerStartError {
    return {
      code: error.code,
      message: error.message,
      configPath: error.configPath ?? null,
      configKey: error.configKey ?? null,
    };
  }

  private serializeStartError(
    cause: unknown,
    context: {
      workspaceId: string;
      runId: string;
      mode: RunnerMode;
      now: () => number;
    }
  ): { error: ContainerStartError; event?: RunnerErrorEvent } {
    if (cause instanceof PortAllocationError) {
      const event: RunnerErrorEvent = {
        ts: context.now(),
        workspaceId: context.workspaceId,
        runId: context.runId,
        mode: context.mode,
        type: 'error',
        code: cause.code,
        message: cause.message,
      };
      return {
        error: {
          code: cause.code,
          message: cause.message,
          configKey: null,
          configPath: null,
        },
        event,
      };
    }

    const message =
      cause instanceof Error ? cause.message : 'Failed to start container run';
    return {
      error: {
        code: 'UNKNOWN',
        message,
        configKey: null,
        configPath: null,
      },
      event: {
        ts: context.now(),
        workspaceId: context.workspaceId,
        runId: context.runId,
        mode: context.mode,
        type: 'error',
        code: 'UNKNOWN',
        message,
      },
    };
  }

  private generateRunId(now: () => number): string {
    return `r_${new Date(now()).toISOString()}`;
  }
}

export const containerRunnerService = new ContainerRunnerService();
