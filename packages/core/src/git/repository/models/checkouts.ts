import { z } from 'zod';
import { checkoutInfoSchema } from '../../api/schemas';

export const gitCheckoutsModelSchema = z.array(checkoutInfoSchema);
export type GitCheckoutsModel = z.infer<typeof gitCheckoutsModelSchema>;
