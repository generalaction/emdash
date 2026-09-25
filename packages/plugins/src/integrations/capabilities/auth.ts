import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';
import type { IntegrationCredentials, IntegrationHostContext } from '../host';

const authFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  secret: z.boolean().default(false),
  required: z.boolean().default(true),
  placeholder: z.string().optional(),
  defaultValue: z.string().optional(),
});

const formMethodSchema = z.object({
  kind: z.literal('form'),
  fields: z.array(authFieldSchema).min(1),
  help: z.string().optional(),
  helpUrl: z.string().optional(),
});

const oauthMethodSchema = z.object({
  kind: z.literal('oauth'),
  providerId: z.string(),
});

const oauthDeviceMethodSchema = z.object({
  kind: z.literal('oauth-device'),
  clientId: z.string(),
  scopes: z.array(z.string()),
});

const cliImportMethodSchema = z.object({
  kind: z.literal('cli-import'),
  cli: z.string(), // e.g "gh"
});

const authMethodSchema = z.discriminatedUnion('kind', [
  formMethodSchema,
  oauthMethodSchema,
  oauthDeviceMethodSchema,
  cliImportMethodSchema,
]);

const authDescriptorSchema = z.object({
  methods: z.array(authMethodSchema).min(1),
  accountLabelRequired: z.boolean().optional(),
});

export type IntegrationAuthField = z.infer<typeof authFieldSchema>;
export type IntegrationAuthMethod = z.infer<typeof authMethodSchema>;
export type IntegrationAuthDescriptor = z.infer<typeof authDescriptorSchema>;

export type VerifiedAccountIdentity = {
  id: string;
  login?: string;
  avatarUrl?: string;
  host?: string;
  scope?: string;
};

export type VerifyResult =
  | {
      connected: true;
      account?: VerifiedAccountIdentity;
      displayName?: string; // user or workspace name
      displayDetail?: string; // e.g. organization or host
      credentials: IntegrationCredentials;
    }
  | { connected: false; error?: string };

export type IIntegrationAuthBehavior = {
  credentialsSchema: z.ZodType<IntegrationCredentials>;
  verify(host: IntegrationHostContext, credentials: IntegrationCredentials): Promise<VerifyResult>;
};

export const integrationAuthCapability = definePluginCapability<IIntegrationAuthBehavior>()(
  'auth',
  authDescriptorSchema,
  undefined,
  { requiresBehavior: () => true }
);
