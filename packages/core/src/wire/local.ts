import type { LiveSource } from '../live/protocol';
import type { ProcedureMap, Wire } from './types';
import { WireError } from './types';

export type LiveResolver = (topic: string) => LiveSource | null;

export function localWire(procedures: ProcedureMap, resolveLive: LiveResolver): Wire {
  return {
    procedures: {
      async call(path, input) {
        const procedure = procedures[path];
        if (!procedure) {
          throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
        }
        return await procedure(input as never);
      },
    },
    live: {
      async snapshot(topic) {
        const source = resolveLive(topic);
        if (!source) {
          throw new WireError('UNKNOWN_TOPIC', `Unknown live topic '${topic}'`);
        }
        return source.snapshot();
      },
      async attach(topic, push) {
        const source = resolveLive(topic);
        if (!source) {
          throw new WireError('UNKNOWN_TOPIC', `Unknown live topic '${topic}'`);
        }
        return source.subscribe(push);
      },
    },
    onDisconnect: () => () => {},
  };
}
