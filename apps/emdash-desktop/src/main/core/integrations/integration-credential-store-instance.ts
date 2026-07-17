import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { log } from '@main/lib/logger';
import { IntegrationCredentialStore } from './integration-credential-store';

type JiraKVSchema = { creds: { siteUrl?: string; email?: string } };
type InstanceKVSchema = { connection: { instanceUrl?: string } };
type PlaneKVSchema = { connection: { apiBaseUrl?: string; workspaceSlug?: string } };

export const integrationCredentialStore = new IntegrationCredentialStore(
  providerAccountRegistry,
  {
    secrets: encryptedAppSecretsStore,
    kv: {
      jira: new KV<JiraKVSchema>('jira'),
      gitlab: new KV<InstanceKVSchema>('gitlab'),
      forgejo: new KV<InstanceKVSchema>('forgejo'),
      plane: new KV<PlaneKVSchema>('plane'),
    },
  },
  log
);
