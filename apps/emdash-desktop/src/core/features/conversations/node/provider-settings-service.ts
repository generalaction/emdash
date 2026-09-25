import { createHash } from 'node:crypto';
import type { SessionConfigState } from '@emdash/core/runtimes/acp/api/client';
import { createKeyedLanes, createScope } from '@emdash/shared/concurrency';
import { expose, family, pokeChannel, query } from '@emdash/wire/state';
import type { AppDb } from '@core/services/app-db/node/db';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { conversationsContract } from '../api/contract';
import {
  emptyProviderSettings,
  providerOptionsCacheSchema,
  acpPreferenceSchema,
  ptyPreferenceSchema,
  type ProviderPreferencePatch,
  type ProviderSettingsKey,
  type ProviderSettingsSnapshot,
} from '../api/provider-settings';

const services = new WeakMap<AppDb, ProviderSettingsService>();
export function getProviderSettingsService(db: AppDb): ProviderSettingsService {
  let service = services.get(db);
  if (!service) {
    service = new ProviderSettingsService(db);
    services.set(db, service);
  }
  return service;
}

/** The sole desktop writer. UI and provider observations never replace an entire preference bag. */
export class ProviderSettingsService {
  private readonly preferences;
  private readonly catalogs;
  private readonly scope = createScope({ label: 'provider-settings' });
  private readonly changes =
    pokeChannel<Pick<ProviderSettingsKey, 'host' | 'providerId'>>('provider-settings');
  private readonly lanes = createKeyedLanes();
  readonly model;

  constructor(db: AppDb) {
    this.preferences = new AppDbKeyValueStore<Record<string, unknown>>(db, 'provider-preferences');
    this.catalogs = new AppDbKeyValueStore<Record<string, unknown>>(db, 'provider-options');
    const states = family(
      (key: ProviderSettingsKey, scope) =>
        query({
          fetch: () => this.read(key),
          scope,
          pokes: [
            this.changes.subscription(
              (change) => change.host === key.host && change.providerId === key.providerId
            ),
          ],
        }),
      { scope: this.scope, name: 'provider-settings', key: JSON.stringify, lingerMs: 30_000 }
    );
    this.model = expose(conversationsContract.providerSettings.model, {
      value: (key, scope) => {
        scope.add(states.retain(key));
        return states(key);
      },
    });
    this.scope.add(() => this.model.dispose());
  }

  private key(scope: ProviderSettingsKey, transport?: 'acp' | 'pty') {
    return JSON.stringify(
      transport ? [scope.host, scope.providerId, transport] : [scope.host, scope.providerId]
    );
  }

  async read(scope: ProviderSettingsKey): Promise<ProviderSettingsSnapshot> {
    const [acp, pty, catalogs] = await Promise.all([
      this.readPreference(scope, 'acp'),
      this.readPreference(scope, 'pty'),
      this.catalogs.getAll(),
    ]);
    return {
      acp,
      pty,
      catalogs: Object.entries(catalogs)
        .flatMap(([key, value]) => {
          const [host, providerId, projectId] = JSON.parse(key) as string[];
          if (
            host !== scope.host ||
            providerId !== scope.providerId ||
            projectId !== (scope.projectId ?? '')
          )
            return [];
          const parsed = providerOptionsCacheSchema.schema.safeParse(value);
          return parsed.success ? [parsed.data.options] : [];
        })
        .reverse(),
    };
  }

  async readPreference<T extends 'acp' | 'pty'>(
    scope: ProviderSettingsKey,
    transport: T
  ): Promise<ProviderSettingsSnapshot[T]> {
    const schema = transport === 'acp' ? acpPreferenceSchema : ptyPreferenceSchema;
    const parsed = schema.schema.safeParse(
      await this.preferences.getOrThrow(this.key(scope, transport))
    );
    return (
      parsed.success ? parsed.data : emptyProviderSettings[transport]
    ) as ProviderSettingsSnapshot[T];
  }

  async patch(scope: ProviderSettingsKey, patch: ProviderPreferencePatch) {
    await this.lanes.run(this.key(scope), new AbortController().signal, async () => {
      if (patch.transport === 'acp') {
        const current = await this.readPreference(scope, 'acp');
        const options = { ...current.options, ...patch.options };
        await this.preferences.setOrThrow(this.key(scope, patch.transport), {
          version: '1',
          options,
        });
      } else {
        await this.preferences.setOrThrow(this.key(scope, patch.transport), {
          version: '1',
          autoApprove: patch.autoApprove,
        });
      }
      this.changes.poke(scope);
    });
    return this.read(scope);
  }

  async observeCatalog(scope: ProviderSettingsKey, config: SessionConfigState) {
    if (!config.discoveryContext || !config.options) return;
    const configuration = config.options
      .map(({ id, currentValue }) => [id, currentValue])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
    const hash = createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
    const key = JSON.stringify([
      scope.host,
      scope.providerId,
      scope.projectId ?? '',
      config.discoveryContext,
      hash,
    ]);
    const value = { version: '1', options: config.options };
    await this.lanes.run(this.key(scope), new AbortController().signal, async () => {
      // Re-observing an unchanged variant still makes it the most recent discovery.
      await this.catalogs.setOrThrow(key, value);
      const entries = Object.keys(await this.catalogs.getAll()).filter((entry) => {
        const [host, provider] = JSON.parse(entry) as string[];
        return host === scope.host && provider === scope.providerId;
      });
      for (const stale of entries.slice(0, Math.max(0, entries.length - 64))) {
        if (stale !== key) await this.catalogs.del(stale);
      }
      this.changes.poke(scope);
    });
    if (Object.keys(config.clearedOptions ?? {}).length) {
      await this.lanes.run(this.key(scope), new AbortController().signal, async () => {
        const current = await this.readPreference(scope, 'acp');
        const options = { ...current.options };
        for (const [id, value] of Object.entries(config.clearedOptions!)) {
          if (options[id] === value) delete options[id];
        }
        await this.preferences.setOrThrow(this.key(scope, 'acp'), { version: '1', options });
        this.changes.poke(scope);
      });
    }
  }

  async dispose() {
    await this.scope.dispose();
  }
}
