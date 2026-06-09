export type ProviderAccountPayload = {
  providerId: string;
  providerAccountId: string;
  host: string;
  login: string;
  avatarUrl: string;
};

export type ProviderTokenPayload = {
  accessToken: string;
  providerAccount?: ProviderAccountPayload;
};

type ProviderTokenHandler = (payload: ProviderTokenPayload) => Promise<void>;

const handlers = new Map<string, ProviderTokenHandler>();

export const providerTokenRegistry = {
  register(provider: string, handler: ProviderTokenHandler): void {
    handlers.set(provider, handler);
  },

  async dispatch(provider: string, payload: ProviderTokenPayload): Promise<void> {
    const handler = handlers.get(provider);
    if (!handler) return;
    await handler(payload);
  },

  /** For testing only — removes all registered handlers. */
  clear(): void {
    handlers.clear();
  },
};
