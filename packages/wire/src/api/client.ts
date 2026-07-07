import type { z } from 'zod';
import { LiveLogClient, type LiveLogClientDeps } from '../live/log';
import { LiveModelClient } from '../live/model';
import type { LiveModelData, LiveModelKey } from '../live/mutations';
import type { LiveLogSnapshotData, LiveSnapshot } from '../live/protocol';
import { encodeTopic } from './bind';
import type { Connection } from './connect';
import type { ContractShape, LiveLogKey, ProcedureInput, ProcedureOutput } from './define';

export type WiredLiveClient<TClient> = {
  client: TClient;
  ready: Promise<void>;
  dispose(): Promise<void>;
};

export type ContractProcedureClient<Contract extends ContractShape> = {
  [Name in keyof Contract['procedures']]: (
    input: ProcedureInput<Contract['procedures'][Name]>
  ) => Promise<ProcedureOutput<Contract['procedures'][Name]>>;
};

export type ContractClient<Contract extends ContractShape> = ContractProcedureClient<Contract> & {
  model<Name extends keyof Contract['models']>(
    name: Name,
    key: LiveModelKey<Contract['models'][Name]>,
    onChange: (value: LiveModelData<Contract['models'][Name]>) => void
  ): WiredLiveClient<LiveModelClient<LiveModelData<Contract['models'][Name]>>>;
  log<Name extends keyof Contract['logs']>(
    name: Name,
    key: LiveLogKey<Contract['logs'][Name]>,
    deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>
  ): WiredLiveClient<LiveLogClient>;
};

export function contractClient<Contract extends ContractShape>(
  contract: Contract,
  connection: Connection,
  options: { pathPrefix?: string } = {}
): ContractClient<Contract> {
  const client: Record<string, unknown> = {};
  const pathPrefix = options.pathPrefix ? `${options.pathPrefix}.` : '';

  for (const name of Object.keys(contract.procedures)) {
    client[name] = (input: unknown) => connection.call(`${pathPrefix}${name}`, input);
  }

  client.model = (
    name: keyof Contract['models'],
    key: unknown,
    onChange: (value: unknown) => void
  ) => {
    const ref = (contract.models as Record<string, Contract['models'][keyof Contract['models']]>)[
      String(name)
    ];
    if (!ref) throw new Error(`Unknown live model '${String(name)}'`);
    const topic = encodeTopic(ref.id, key);
    const fetchSnapshot = () =>
      connection.snapshot(topic) as Promise<LiveSnapshot<z.infer<typeof ref.dataSchema>>>;
    const model = new LiveModelClient(ref.dataSchema, fetchSnapshot, onChange);
    const ready = fetchSnapshot().then((snapshot) => model.seed(snapshot));
    const detach = connection.attach(topic, (update) => model.applyUpdate(update));
    return {
      client: model,
      ready,
      async dispose() {
        (await detach)();
      },
    };
  };

  client.log = (
    name: keyof Contract['logs'],
    key: unknown,
    deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>
  ) => {
    const ref = (contract.logs as Record<string, Contract['logs'][keyof Contract['logs']]>)[
      String(name)
    ];
    if (!ref) throw new Error(`Unknown live log '${String(name)}'`);
    const topic = encodeTopic(ref.id, key);
    const log = new LiveLogClient({
      ...deps,
      refetchSnapshot: () =>
        connection.snapshot(topic) as Promise<LiveSnapshot<LiveLogSnapshotData>>,
    });
    const ready = connection
      .snapshot(topic)
      .then((snapshot) => log.seed(snapshot as LiveSnapshot<LiveLogSnapshotData>));
    const detach = connection.attach(topic, (update) => log.applyUpdate(update));
    return {
      client: log,
      ready,
      async dispose() {
        (await detach)();
      },
    };
  };

  return client as ContractClient<Contract>;
}
