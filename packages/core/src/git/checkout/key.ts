import { z } from 'zod';

/** Identifies a checkout (working tree) by its canonical (realpath-resolved) path. */
export const checkoutKeySchema = z.object({ checkoutPath: z.string() });
export type CheckoutKey = z.infer<typeof checkoutKeySchema>;
