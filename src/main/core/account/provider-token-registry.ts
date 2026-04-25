type ProviderTokenHandler = (token: string) => Promise<void>;

const handlers = new Map<string, ProviderTokenHandler>();

export const providerTokenRegistry = {
  register(provider: string, handler: ProviderTokenHandler): void {
    handlers.set(provider, handler);
  },

  async dispatch(provider: string, token: string): Promise<void> {
    const handler = handlers.get(provider);
    if (!handler) return;
    await handler(token);
  },

  /** For testing only — removes all registered handlers. */
  clear(): void {
    handlers.clear();
  },
};
