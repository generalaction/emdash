import type { Result } from '@agent/shared';
import { definePluginCapability } from '@agent/shared/plugins';
import z from 'zod';
import type { IntegrationCredentials, IntegrationHostContext } from '../host';
import type { IntegrationError } from '../types';

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
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
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

const authDescriptorSchema = z
  .object({
    methods: z.array(authMethodSchema).min(1),
    accountLabelRequired: z.boolean().optional(),
  })
  .superRefine(({ methods }, ctx) => {
    const forms = methods.filter((method) => method.kind === 'form');
    if (forms.length < 2) return;

    const ids = new Set<string>();
    methods.forEach((method, index) => {
      if (method.kind !== 'form') return;
      if (!method.id || ids.has(method.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Multiple form methods require unique, nonempty IDs.',
          path: ['methods', index, 'id'],
        });
      }
      if (method.id) ids.add(method.id);
      if (!method.label) {
        ctx.addIssue({
          code: 'custom',
          message: 'Multiple form methods require labels.',
          path: ['methods', index, 'label'],
        });
      }
    });
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

/** A pending OAuth device authorization (RFC 8628) shown to the user. */
export type DeviceAuthorizationSession = {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Seconds until the user code expires. */
  expiresIn: number;
  /** Polls until the user approves; resolves with credentials to pass to `verify`. */
  complete(signal: AbortSignal): Promise<Result<IntegrationCredentials, IntegrationError>>;
};

/** An access token issued through the Agent auth server, which keeps the refresh token. */
export type OAuthAccessToken = {
  accessToken: string;
  /** Epoch milliseconds; absent for tokens that do not expire. */
  expiresAt?: number;
  /** Provider host of the account, e.g. `gitlab.com`. */
  host: string;
};

export type IIntegrationAuthBehavior = {
  credentialsSchema: z.ZodType<IntegrationCredentials>;
  verify(
    host: IntegrationHostContext,
    credentials: IntegrationCredentials,
    methodId?: string
  ): Promise<VerifyResult>;
  /** Required when the descriptor declares an `oauth-device` method. */
  startDeviceAuthorization?(
    host: IntegrationHostContext
  ): Promise<Result<DeviceAuthorizationSession, IntegrationError>>;
  /**
   * Required when the descriptor declares an `oauth` method. Credentials that
   * expire must carry the token's `expiresAt` so the host renews them in time.
   */
  credentialsFromOAuthToken?(token: OAuthAccessToken): IntegrationCredentials;
  /**
   * Called by the host when credentials the integration issued itself (e.g. by
   * device sign-in) expire soon. Returns replacement credentials, or `undefined`
   * when these credentials cannot be refreshed. The host persists the result
   * before handing it out and serializes calls per account, so a rotating
   * refresh token is never used twice.
   */
  refreshCredentials?(
    host: IntegrationHostContext,
    credentials: IntegrationCredentials,
    now: number
  ): Promise<Result<IntegrationCredentials | undefined, IntegrationError>>;
};

/** Expiring credentials carry `expiresAt` in epoch milliseconds. */
export function credentialsExpireAt(credentials: IntegrationCredentials): number | undefined {
  const expiresAt = credentials.expiresAt;
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt : undefined;
}

export const integrationAuthCapability = definePluginCapability<IIntegrationAuthBehavior>()(
  'auth',
  authDescriptorSchema,
  undefined,
  { requiresBehavior: () => true }
);
