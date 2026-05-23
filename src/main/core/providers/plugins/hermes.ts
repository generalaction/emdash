import { createProviderPlugin } from '../types';

// Hermes uses the generic classifier fallback.
export const hermesPlugin = createProviderPlugin(() => ({}));
