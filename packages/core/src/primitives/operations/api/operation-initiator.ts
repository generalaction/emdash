import z from 'zod';

export const operationInitiatorSchema = z.object({
  clientId: z.string().min(1),
  label: z.string().min(1).optional(),
});

export type OperationInitiator = z.infer<typeof operationInitiatorSchema>;
