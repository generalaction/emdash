import { z } from 'zod';

/** A reconnect-stable path supplied by the client. Canonical host paths never cross Wire. */
export const gitPathSelectorSchema = z.object({ path: z.string().min(1) });
export type GitPathSelector = z.infer<typeof gitPathSelectorSchema>;

export const repositorySelectorSchema = z.object({ repository: gitPathSelectorSchema });
export type RepositorySelector = z.infer<typeof repositorySelectorSchema>;

export const checkoutSelectorSchema = z.object({ checkout: gitPathSelectorSchema });
export type CheckoutSelector = z.infer<typeof checkoutSelectorSchema>;

export const gitSelectorSchema = z.union([repositorySelectorSchema, checkoutSelectorSchema]);
export type GitSelector = z.infer<typeof gitSelectorSchema>;
