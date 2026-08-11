import { afterEach, describe, expect, it } from 'vitest';
import { createAppScope, getAppStores, resetAppScope } from './app-scope';
import { contributeScopedStore, scopedStoreToken } from './scoped-store-host';

class FakeProjects {
  readyConnections: string[] = [];
  onSshConnectionReady(connectionId: string): void {
    this.readyConnections.push(connectionId);
  }
}

class FakeMachines {
  activated = false;
  disposed = false;
  constructor(private readonly onConnectionReady: (connectionId: string) => void) {}
  simulateConnectionReady(connectionId: string): void {
    this.onConnectionReady(connectionId);
  }
}

const projectsToken = scopedStoreToken<FakeProjects>('test.projects');
const machinesToken = scopedStoreToken<FakeMachines>('test.machines');

function testContributions() {
  return [
    contributeScopedStore({
      token: projectsToken,
      create: () => new FakeProjects(),
    }),
    contributeScopedStore({
      token: machinesToken,
      // Mirrors the real machines contribution: the projects store is resolved
      // through the lookup at callback time, not at construction.
      create: (_context, stores) =>
        new FakeMachines((connectionId) => {
          stores.get(projectsToken).onSshConnectionReady(connectionId);
        }),
      activate: (store) => {
        store.activated = true;
      },
      dispose: (store) => {
        store.disposed = true;
      },
    }),
  ];
}

afterEach(() => {
  resetAppScope();
});

describe('app scope', () => {
  it('throws with a bootstrap-ordering message before createAppScope runs', () => {
    expect(() => getAppStores()).toThrowError(/createAppScope must run in renderer bootstrap/);
  });

  it('creates stores and activates them synchronously', () => {
    createAppScope(testContributions());
    const machines = getAppStores().get(machinesToken);
    expect(machines.activated).toBe(true);
  });

  it('throws when created twice', () => {
    createAppScope(testContributions());
    expect(() => createAppScope(testContributions())).toThrowError(
      /createAppScope was called twice/
    );
  });

  it('routes the machines connection callback to the projects store via lookup', () => {
    createAppScope(testContributions());
    const stores = getAppStores();
    stores.get(machinesToken).simulateConnectionReady('conn-1');
    expect(stores.get(projectsToken).readyConnections).toEqual(['conn-1']);
  });

  it('resetAppScope disposes stores and allows re-creation', () => {
    createAppScope(testContributions());
    const machines = getAppStores().get(machinesToken);
    resetAppScope();
    expect(machines.disposed).toBe(true);
    expect(() => getAppStores()).toThrowError(/createAppScope must run in renderer bootstrap/);
    createAppScope(testContributions());
    expect(getAppStores().get(machinesToken)).not.toBe(machines);
  });
});
