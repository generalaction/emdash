import {
  installationCanUpdate,
  type DependencyDescriptor,
  type DependencyId,
  type DependencyState,
  type DependencyStatusUpdatedEvent,
  type HostDependency,
  type Installation,
  type HostDependencyManager,
} from '@emdash/shared/deps/runtime';
import type { Logger } from '@emdash/shared/lib';
import semver from 'semver';
import { events } from '@main/lib/events';
import { agentInstallationStatusUpdatedChannel } from '@shared/events/appEvents';
import { toAgentInstallationStatus } from '../agents/agent-payload-builder';
import { LatestVersionService } from './latest-version-service';
import { getDependencyDescriptor } from './registry';

function isNewerVersion(installed: string, latest: string): boolean {
  const a = semver.coerce(installed);
  const b = semver.coerce(latest);
  if (a === null || b === null) return false;
  return semver.gt(b, a);
}

type UpdateInfo = {
  latestVersion: string | null;
  updateAvailable: boolean;
};

type StoredEvent = {
  raw: DependencyStatusUpdatedEvent;
  installedVersion: string | null;
};

/**
 * Desktop orchestrator for update-availability.
 * Owns the LatestVersionService and computes latestVersion/updateAvailable per dependency.
 * Subscribes to manager.onStatusUpdated events, enriches them with update info, and
 * emits the enriched events on the desktop event channels.
 *
 * A single instance is shared across local and SSH managers (latest-version is host-agnostic;
 * updateAvailable is computed per-host from each host's reported installed version).
 *
 * Gating: each installation's updateAvailable is additionally gated through
 * installationCanUpdate() — unknown-source installs with a package-manager strategy
 * report updateAvailable=false so the row badge and card stay in sync.
 */
export class AgentUpdateService {
  private readonly latestVersionService: LatestVersionService;
  private readonly logger?: Logger;
  /** Cache of latest versions keyed by dep id. */
  private latestVersionCache = new Map<DependencyId, string | null>();
  /** Last raw event per (connectionId ?? 'local', depId) for re-emitting after async fetch. */
  private storedEvents = new Map<string, StoredEvent>();

  constructor(options?: { logger?: Logger }) {
    this.latestVersionService = new LatestVersionService({ logger: options?.logger });
    this.logger = options?.logger;
  }

  /**
   * Subscribe to a manager's onStatusUpdated events: enrich with latest-version
   * data and emit on the desktop channels. Called once per manager instance.
   */
  attach(manager: HostDependencyManager, connectionId?: string): void {
    manager.onStatusUpdated.subscribe((event) => {
      this.handleManagerEvent(event, connectionId);
    });
  }

  /** Returns cached update info for a dep. null/false when unknown. */
  getUpdateInfo(id: DependencyId, installedVersion: string | null): UpdateInfo {
    const latestVersion = this.latestVersionCache.get(id) ?? null;
    const updateAvailable =
      latestVersion !== null && installedVersion !== null
        ? isNewerVersion(installedVersion, latestVersion)
        : false;
    return { latestVersion, updateAvailable };
  }

  /**
   * Force a cache invalidation + re-fetch + re-emit for a single dependency.
   * Called by the controller's `refreshLatestVersion` RPC.
   */
  async refreshLatestVersion(id: DependencyId, connectionId?: string): Promise<void> {
    const descriptor = getDependencyDescriptor(id);
    if (!descriptor) return;

    // Invalidate cache so the next fetch goes to the network
    if (descriptor.updates?.kind === 'supported') {
      this.latestVersionService.invalidate(descriptor.updates.releaseSource);
    }
    this.latestVersionCache.delete(id as DependencyId);

    await this.fetchLatestAndReemit(id as DependencyId, descriptor, connectionId);
  }

  /**
   * Enrich a HostDependency with latestVersion/updateAvailable for each installation,
   * gated by installationCanUpdate(source, strategyKind). Public so the controller and
   * payload builder can enrich manager snapshots on demand (e.g. for RPC reads).
   */
  enrichHostDependency(id: DependencyId, hostDep: HostDependency): HostDependency {
    const latestVersion = this.latestVersionCache.get(id) ?? null;
    return this.applyEnrichment(id, hostDep, latestVersion);
  }

  private handleManagerEvent(event: DependencyStatusUpdatedEvent, connectionId?: string): void {
    const storageKey = `${connectionId ?? 'local'}:${event.id}`;
    this.storedEvents.set(storageKey, { raw: event, installedVersion: event.state.version });

    const latestCached = this.latestVersionCache.get(event.id as DependencyId);

    if (latestCached !== undefined) {
      // We have a cached latest version — enrich and emit immediately
      this.emitEnrichedEvent(event, latestCached, connectionId);
    } else {
      // Emit the raw event first (no update info yet), then kick off async fetch
      this.emitEnrichedEvent(event, null, connectionId);

      const descriptor = getDependencyDescriptor(event.id);
      if (descriptor) {
        void this.fetchLatestAndReemit(event.id as DependencyId, descriptor, connectionId);
      }
    }
  }

  private async fetchLatestAndReemit(
    id: DependencyId,
    descriptor: DependencyDescriptor,
    connectionId?: string
  ): Promise<void> {
    if (!descriptor.updates || descriptor.updates.kind !== 'supported') return;
    const { releaseSource } = descriptor.updates;
    if (releaseSource.kind === 'none') return;

    let latestVersion: string | null;
    if (descriptor.updateHooks?.resolveLatestVersion) {
      try {
        latestVersion = await descriptor.updateHooks.resolveLatestVersion();
      } catch {
        latestVersion = null;
      }
    } else {
      latestVersion = await this.latestVersionService.fetchLatestVersion(releaseSource);
    }

    this.latestVersionCache.set(id, latestVersion);

    // Re-emit with enriched data using the latest stored event for this host+dep
    const storageKey = `${connectionId ?? 'local'}:${id}`;
    const stored = this.storedEvents.get(storageKey);
    if (stored) {
      this.emitEnrichedEvent(stored.raw, latestVersion, connectionId);
    }
  }

  private emitEnrichedEvent(
    event: DependencyStatusUpdatedEvent,
    latestVersion: string | null,
    connectionId?: string
  ): void {
    const updateAvailable =
      latestVersion !== null && event.state.version !== null
        ? isNewerVersion(event.state.version, latestVersion)
        : false;

    const enrichedState: DependencyState = {
      ...event.state,
      latestVersion,
      updateAvailable,
    };

    const enrichedHostDep = event.hostDependency
      ? this.applyEnrichment(event.id as DependencyId, event.hostDependency, latestVersion)
      : undefined;

    if (enrichedHostDep) {
      const dto = toAgentInstallationStatus(event.id, connectionId, enrichedState, enrichedHostDep);
      events.emit(agentInstallationStatusUpdatedChannel, dto);
    }
  }

  /**
   * Core enrichment: sets latestVersion and updateAvailable on each installation,
   * gating updateAvailable through installationCanUpdate so unknown+package-manager
   * installations never report an actionable update.
   */
  private applyEnrichment(
    id: DependencyId,
    hostDep: HostDependency,
    latestVersion: string | null
  ): HostDependency {
    const descriptor = getDependencyDescriptor(id);
    const updates = descriptor?.updates;
    const strategyKind = updates?.kind === 'supported' ? updates.update.kind : ('none' as const);

    const installations = hostDep.installations.map((inst): Installation => {
      if (inst.version === null) return { ...inst, latestVersion: null, updateAvailable: false };
      const rawDiff = latestVersion !== null ? isNewerVersion(inst.version, latestVersion) : false;
      const updateAvailable =
        rawDiff && installationCanUpdate(inst.source, inst.inferredMethod ?? null, strategyKind);
      return { ...inst, latestVersion, updateAvailable };
    });
    return { ...hostDep, installations };
  }
}

export const agentUpdateService = new AgentUpdateService();
