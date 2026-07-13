import { eventStreamDeltaSchema, type LiveUpdate } from '../protocol';

export function eventFromUpdate<Event = unknown>(update: LiveUpdate): Event {
  return eventStreamDeltaSchema.parse(update.delta).event as Event;
}
