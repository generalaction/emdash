import { z } from 'zod';
import { hostAbsolutePathSchema } from '#primitives/path/api';

export const MAX_LSP_DOCUMENT_LENGTH = 2_000_000;
export const lspServerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);

export const lspPositionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});

export const lspRangeSchema = z.object({ start: lspPositionSchema, end: lspPositionSchema });

export const lspSessionKeySchema = z.object({
  clientId: z.string().min(1).max(128),
  root: hostAbsolutePathSchema,
  serverId: lspServerIdSchema,
});
export const lspProjectRootQuerySchema = z.object({
  workspaceRoot: hostAbsolutePathSchema,
  path: hostAbsolutePathSchema,
  serverId: lspServerIdSchema,
});

export const lspDocumentSchema = z.object({
  path: hostAbsolutePathSchema,
  languageId: z.string().min(1).max(64),
  version: z.number().int().nonnegative().max(2_147_483_647),
  text: z.string().max(MAX_LSP_DOCUMENT_LENGTH),
});

export const lspQuerySchema = z.object({
  session: lspSessionKeySchema,
  path: hostAbsolutePathSchema,
  version: lspDocumentSchema.shape.version,
  position: lspPositionSchema,
});
export const lspDocumentEditSchema = z.object({
  start: z.number().int().min(0).max(MAX_LSP_DOCUMENT_LENGTH),
  deleteCount: z.number().int().min(0).max(MAX_LSP_DOCUMENT_LENGTH),
  text: z.string().max(MAX_LSP_DOCUMENT_LENGTH),
});
export const lspDocumentChangeSchema = z.object({
  path: hostAbsolutePathSchema,
  baseVersion: lspDocumentSchema.shape.version,
  version: lspDocumentSchema.shape.version,
  edit: lspDocumentEditSchema,
});

export const lspErrorSchema = z.object({
  type: z.enum([
    'session-unavailable',
    'request-failed',
    'cancelled',
    'unsupported',
    'document-out-of-sync',
    'stale-query',
  ]),
  message: z.string(),
});

export const lspDiagnosticSchema = z.object({
  range: lspRangeSchema,
  message: z.string(),
  severity: z.number().int().min(1).max(4).optional(),
  source: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  tags: z.array(z.number()).optional(),
});

export const lspCapabilitiesSchema = z.object({
  hover: z.boolean(),
  definition: z.boolean(),
  typeDefinition: z.boolean(),
  references: z.boolean(),
});

export const lspStateSchema = z.object({
  phase: z.enum(['starting', 'ready', 'failed']),
  generation: z.string(),
  capabilities: lspCapabilitiesSchema,
  diagnostics: z.array(
    z.object({
      path: hostAbsolutePathSchema,
      version: z.number().optional(),
      diagnostics: z.array(lspDiagnosticSchema),
    })
  ),
  error: z.string().optional(),
});

export const lspHoverSchema = z
  .object({ contents: z.string(), range: lspRangeSchema.optional() })
  .nullable();

export const lspLocationSchema = z.object({
  path: hostAbsolutePathSchema,
  range: lspRangeSchema,
  originRange: lspRangeSchema.optional(),
});

export type LspSessionKey = z.infer<typeof lspSessionKeySchema>;
export type LspProjectRootQuery = z.infer<typeof lspProjectRootQuerySchema>;
export type LspDocumentEdit = z.infer<typeof lspDocumentEditSchema>;
export type LspDocumentChange = z.infer<typeof lspDocumentChangeSchema>;
export type LspDocument = z.infer<typeof lspDocumentSchema>;
export type LspQuery = z.infer<typeof lspQuerySchema>;
export type LspError = z.infer<typeof lspErrorSchema>;
export type LspState = z.infer<typeof lspStateSchema>;
export type LspHover = z.infer<typeof lspHoverSchema>;
export type LspLocation = z.infer<typeof lspLocationSchema>;
