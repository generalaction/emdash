import type { LiveUpdate } from '@emdash/core/live';
import { defineEvent } from '@shared/lib/ipc/events';

export const wireLiveUpdateChannel = defineEvent<LiveUpdate>('wire:live-update');

export function wireEventTopic(ns: string, topic: string): string {
  return `${ns}/${topic}`;
}
