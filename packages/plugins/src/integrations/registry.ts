import { createPluginRegistry } from '@emdash/shared/plugins';
import type { IntegrationPluginProvider } from './plugin';

export const integrationPluginRegistry = createPluginRegistry<IntegrationPluginProvider>();
