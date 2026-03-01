import { type IpcMain } from 'electron';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProcedureMap = Record<string, (...args: any[]) => unknown>;

export function createRPCController<T extends ProcedureMap>(handlers: T): T {
  return handlers;
}

type RouterMap = Record<string, ProcedureMap>;

export function createRPCRouter<T extends RouterMap>(routers: T): T {
  return routers;
}

export function registerRPCRouter(router: RouterMap, ipcMain: IpcMain): void {
  for (const [ns, handlers] of Object.entries(router)) {
    for (const [key, fn] of Object.entries(handlers)) {
      const channel = `${ns}.${key}`;
      ipcMain.handle(channel, (_event, ...args: unknown[]) => fn(...args));
    }
  }
}

type IpcClient<R extends RouterMap> = {
  [NS in keyof R]: {
    [P in keyof R[NS]]: R[NS][P] extends (...args: infer A) => infer Ret
      ? (...args: A) => Promise<Awaited<Ret>>
      : never;
  };
};

export function createRPCClient<Router extends RouterMap>(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
): IpcClient<Router> {
  return new Proxy(
    {},
    {
      get(_, ns: string) {
        if (typeof ns !== 'string' || ns === 'then') return undefined;
        return new Proxy(
          {},
          {
            get(_, procedure: string) {
              if (typeof procedure !== 'string' || procedure === 'then') return undefined;
              return (...args: unknown[]) => invoke(`${ns}.${procedure}`, ...args);
            },
          }
        );
      },
    }
  ) as IpcClient<Router>;
}
