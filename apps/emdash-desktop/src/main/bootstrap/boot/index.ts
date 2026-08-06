import { closeAppDb } from '@main/db/instance';
import { appScope } from '../core/app-scope';
import type { AppConfig } from '../core/config';
import { step, stepOptional } from '../core/phase';
import { configureShutdownRuntimeClients } from '../shutdown';
import { configureQuitCleanupServices } from '../shutdown/phases';
import { bootBackground } from './phases/background';
import { bootControllers } from './phases/controllers';
import { bootDatabase } from './phases/database';
import { installGateway } from './phases/gateway';
import { bootInfrastructure } from './phases/infrastructure';
import { bootRuntimes } from './phases/runtimes';
import { bootServices } from './phases/services';
import { bootWindow } from './phases/window';
import type { BootSignals } from './types';

export async function finishBoot(config: AppConfig, signals: BootSignals): Promise<void> {
  const database = await step('database', () => bootDatabase(config));
  try {
    const infrastructure = await step('infrastructure', () => bootInfrastructure(database));
    const runtimes = await step('runtimes', () => bootRuntimes(database, infrastructure));
    const services = await step('services', () => bootServices(database, infrastructure, runtimes));
    configureQuitCleanupServices({
      automations: services.automations,
      projects: services.projects,
      pullRequests: services.pullRequestsRegistration,
      runtimes,
    });
    configureShutdownRuntimeClients(runtimes.clients);
    const controllers = await step('controllers', () =>
      bootControllers(database, infrastructure, runtimes, services)
    );
    await step('gateway', () => installGateway(controllers, database, services, runtimes));
    await step('window', () => bootWindow(signals));
    await stepOptional('background-tasks', () => bootBackground(services, runtimes));
  } catch (error) {
    try {
      await appScope.dispose(error);
    } finally {
      closeAppDb();
    }
    throw error;
  }
}
