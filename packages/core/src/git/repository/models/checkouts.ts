import { z } from 'zod';
import { checkoutInfoSchema } from '../../api/queries';

export const gitCheckoutsModelSchema = z.array(checkoutInfoSchema);
export type GitCheckoutsModel = z.infer<typeof gitCheckoutsModelSchema>;
