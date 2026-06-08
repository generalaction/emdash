type EventDefinition<TData> = {
  name: string;
  _data?: TData;
};

export function defineEvent<TData>(name: string): EventDefinition<TData> {
  return {
    name,
  };
}

export type EmitterAdapter = {
  emit: (eventName: string, data: unknown, topic?: string) => void;
  on: (eventName: string, cb: (data: unknown) => void, topic?: string) => () => void;
};

export function createEventEmitter(adapter: EmitterAdapter) {
  // One adapter listener per channel; all JS subscribers fan out from it.
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const adapterOff = new Map<string, () => void>();

  function getOrAttach(channel: string): Set<(data: unknown) => void> {
    if (!listeners.has(channel)) {
      const set = new Set<(data: unknown) => void>();
      listeners.set(channel, set);
      adapterOff.set(
        channel,
        adapter.on(channel, (data) => {
          for (const cb of set) {
            try {
              cb(data);
            } catch {}
          }
        })
      );
    }
    return listeners.get(channel)!;
  }

  function maybePrune(channel: string): void {
    if (listeners.get(channel)?.size === 0) {
      listeners.delete(channel);
      adapterOff.get(channel)?.();
      adapterOff.delete(channel);
    }
  }

  return {
    emit: <TData>(event: EventDefinition<TData>, data: TData, topic?: string): void => {
      adapter.emit(event.name, data, topic);
    },
    on: <TData>(
      event: EventDefinition<TData>,
      cb: (data: TData) => void,
      topic?: string
    ): (() => void) => {
      const channel = topic ? `${event.name}.${topic}` : event.name;
      const wrapped = (data: unknown) => cb(data as TData);
      getOrAttach(channel).add(wrapped);
      return () => {
        listeners.get(channel)?.delete(wrapped);
        maybePrune(channel);
      };
    },
    once: <TData>(
      event: EventDefinition<TData>,
      cb: (data: TData) => void,
      topic?: string
    ): (() => void) => {
      const channel = topic ? `${event.name}.${topic}` : event.name;
      const set = getOrAttach(channel);
      const unsub = () => {
        set.delete(wrapped);
        maybePrune(channel);
      };
      const wrapped = (data: unknown) => {
        cb(data as TData);
        unsub();
      };
      set.add(wrapped);
      return unsub;
    },
  };
}
