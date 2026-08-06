import { defineEvent } from '@shared/lib/ipc/events';
import type { Loop, LoopPhase } from './loops';

export const loopUpdatedChannel = defineEvent<{ loop: Loop }>('loop:updated');

export const loopPhaseUpdatedChannel = defineEvent<{
  loopId: string;
  phase: LoopPhase;
}>('loop:phase-updated');
