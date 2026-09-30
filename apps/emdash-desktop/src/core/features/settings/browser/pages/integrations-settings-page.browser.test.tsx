import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import { issuesPluginRegistry } from '@emdash/plugins/issues';
import '@emdash/ui/style.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import {
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
  PROVIDER_ACCOUNTS_QUERY_KEY,
} from '@core/features/integrations/api/browser/use-provider-accounts';
import type { IntegrationProviderDescriptor } from '@core/features/integrations/api/contract';
import {
  INTEGRATION_PROVIDERS_QUERY_KEY,
  IntegrationsProvider,
} from '@core/features/integrations/contributions/browser/integrations-provider';
import { ThemeProvider } from '@core/primitives/theme/browser';
import { IntegrationsSettingsPage } from './integrations-settings-page';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const providers: IntegrationProviderDescriptor[] = integrationPluginRegistry
    .getAll()
    .map((provider) => {
      const issues = issuesPluginRegistry.get(provider.metadata.id);
      return {
        ...provider.metadata,
        features:
          provider.metadata.id === 'github'
            ? ['issues', 'pullRequests', 'repositories']
            : ['issues'],
        auth: provider.capabilities.auth,
        icon: provider.assets.icon,
        issueCapabilities: {
          requiresRepositoryUrl:
            issues?.capabilities.issues.requiredInputs.includes('repositoryUrl') ?? false,
          supportsIssueContext: !!issues?.behavior.issues?.getIssue,
        },
      };
    });
  queryClient.setQueryData(INTEGRATION_PROVIDERS_QUERY_KEY, providers);
  queryClient.setQueryData(PROVIDER_ACCOUNTS_QUERY_KEY, {});
  queryClient.setQueryData(ISSUE_CONNECTION_STATUS_QUERY_KEY, {});
  container = document.createElement('div');
  container.style.width = '940px';
  container.style.padding = '24px';
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  queryClient.clear();
  container.remove();
});

it.each(['emlight', 'emdark'] as const)(
  'shows the official YouTrack icon in the Integrations list in %s',
  async (theme) => {
    await page.viewport(1000, 900);
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme={theme} onThemeChange={() => {}}>
            <IntegrationsProvider>
              <IntegrationsSettingsPage />
            </IntegrationsProvider>
          </ThemeProvider>
        </QueryClientProvider>
      )
    );
    const youTrack = page.getByRole('button', { name: /YouTrack.*Work on YouTrack tickets/ });
    await expect.element(youTrack).toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: 'Integrations', exact: true }))
      .toBeVisible();
    const card = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Work on YouTrack tickets')
    );
    const icon = card?.querySelector('svg');
    expect(icon?.getAttribute('viewBox')).toBe('0 0 64 64');
    expect(icon?.innerHTML).toContain('youtrack-gradient');
    await page.screenshot();
  }
);
