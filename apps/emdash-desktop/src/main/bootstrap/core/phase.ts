import { log } from '@main/lib/logger';

export interface Phase<Context> {
  readonly name: string;
  readonly critical?: boolean;
  run(context: Context): void | Promise<void>;
}

export async function runPhase<Context>(phase: Phase<Context>, context: Context): Promise<void> {
  const startedAt = Date.now();
  log.info('Lifecycle phase started', { phase: phase.name });
  try {
    await phase.run(context);
    log.info('Lifecycle phase completed', {
      phase: phase.name,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    log.error('Lifecycle phase failed', {
      phase: phase.name,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}
