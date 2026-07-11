import z from 'zod';

export const LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX = 'persist:emdash-browser-loop-verification-';

const boundedIdSchema = z.string().trim().min(1).max(256);
const boundedTextSchema = z.string().max(16_384);
const timestampSchema = z.string().trim().min(1).max(64);

const safeHttpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username.length === 0 &&
        url.password.length === 0
      );
    } catch {
      return false;
    }
  }, 'Expected an HTTP(S) URL without embedded credentials');

const previewOriginSchema = safeHttpUrlSchema.refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, 'Expected an exact HTTP(S) origin');

function matchesOrigin(url: string, allowedOrigin: string): boolean {
  return new URL(url).origin === allowedOrigin;
}

const disposablePartitionSchema = z
  .string()
  .min(LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX.length + 1)
  .max(512)
  .regex(/^persist:emdash-browser-loop-verification-[a-zA-Z0-9_-]+$/);

const loopBrowserLeaseShape = {
  verificationRunId: boundedIdSchema,
  browserId: boundedIdSchema,
  projectId: boundedIdSchema,
  taskId: boundedIdSchema,
  workspaceId: boundedIdSchema,
  partition: disposablePartitionSchema,
  allowedPreviewOrigin: previewOriginSchema,
};

export const loopBrowserLeaseSchema = z.object(loopBrowserLeaseShape).strict();

export const loopBrowserTargetSchema = z
  .object({
    role: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(256).optional(),
    testId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .refine(
    (target) =>
      target.role !== undefined || target.name !== undefined || target.testId !== undefined,
    {
      message: 'An accessibility role, name, or test ID is required',
    }
  );

export const loopBrowserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: safeHttpUrlSchema }).strict(),
  z.object({ kind: z.literal('accessibility-snapshot') }).strict(),
  z
    .object({
      kind: z.literal('accessibility-query'),
      target: loopBrowserTargetSchema,
      limit: z.number().int().positive().max(50).default(20),
    })
    .strict(),
  z.object({ kind: z.literal('click'), target: loopBrowserTargetSchema }).strict(),
  z
    .object({
      kind: z.literal('fill'),
      target: loopBrowserTargetSchema,
      value: boundedTextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('keypress'),
      key: z.enum([
        'Enter',
        'Escape',
        'Tab',
        'Space',
        'Backspace',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('screenshot'),
      label: z.string().trim().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('diagnostics'),
      limit: z.number().int().positive().max(50).default(20),
    })
    .strict(),
]);

const accessibilityMatchSchema = z
  .object({
    nodeId: boundedIdSchema,
    role: z.string().max(64),
    name: z.string().max(512),
    value: z.string().max(2048).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const browserArtifactSchema = z
  .object({
    artifactId: boundedIdSchema,
    mimeType: z.enum(['image/png', 'image/jpeg']),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
  })
  .strict();

const redactedDiagnosticSchema = z
  .object({
    level: z.enum(['info', 'warning', 'error']),
    source: z.enum(['console', 'navigation', 'network']),
    message: z.string().max(2048),
    redacted: z.literal(true),
  })
  .strict();

export const loopBrowserObservationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('navigation'),
      currentUrl: safeHttpUrlSchema,
      title: z.string().max(512).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('accessibility-snapshot'),
      snapshot: z.string().max(65_536),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('accessibility-query'),
      matches: z.array(accessibilityMatchSchema).max(50),
      truncated: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('interaction'), currentUrl: safeHttpUrlSchema }).strict(),
  z.object({ kind: z.literal('screenshot'), artifact: browserArtifactSchema }).strict(),
  z
    .object({
      kind: z.literal('diagnostics'),
      entries: z.array(redactedDiagnosticSchema).max(50),
      truncated: z.boolean(),
    })
    .strict(),
]);

export const loopBrowserActionResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      observation: loopBrowserObservationSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          kind: z.enum([
            'not-ready',
            'lease-closed',
            'identity-mismatch',
            'origin-rejected',
            'invalid-action',
            'target-not-found',
            'action-failed',
            'artifact-failed',
          ]),
          message: z.string().max(2048),
        })
        .strict(),
    })
    .strict(),
]);

export const loopBrowserCloseReasonSchema = z.enum([
  'completed',
  'failed',
  'cancelled',
  'reconnecting',
  'origin-changed',
  'experiment-disabled',
  'app-shutdown',
]);

export const loopBrowserRequestMessageSchema = z
  .object({
    type: z.literal('request'),
    ...loopBrowserLeaseShape,
    previewUrl: safeHttpUrlSchema,
    requestedAt: timestampSchema,
  })
  .strict()
  .superRefine((message, ctx) => {
    if (!matchesOrigin(message.previewUrl, message.allowedPreviewOrigin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['previewUrl'],
        message: 'Preview URL must match the lease origin',
      });
    }
  });

export const loopBrowserReadyMessageSchema = z
  .object({
    type: z.literal('ready'),
    ...loopBrowserLeaseShape,
    currentUrl: safeHttpUrlSchema,
    readyAt: timestampSchema,
  })
  .strict()
  .superRefine((message, ctx) => {
    if (!matchesOrigin(message.currentUrl, message.allowedPreviewOrigin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['currentUrl'],
        message: 'Ready URL must match the lease origin',
      });
    }
  });

export const loopBrowserActionMessageSchema = z
  .object({
    type: z.literal('action'),
    ...loopBrowserLeaseShape,
    actionId: boundedIdSchema,
    action: loopBrowserActionSchema,
  })
  .strict()
  .superRefine((message, ctx) => {
    if (
      message.action.kind === 'navigate' &&
      !matchesOrigin(message.action.url, message.allowedPreviewOrigin)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['action', 'url'],
        message: 'Navigation URL must match the lease origin',
      });
    }
  });

export const loopBrowserResultMessageSchema = z
  .object({
    type: z.literal('result'),
    ...loopBrowserLeaseShape,
    actionId: boundedIdSchema,
    result: loopBrowserActionResultSchema,
  })
  .strict()
  .superRefine((message, ctx) => {
    if (!message.result.ok) return;
    const observation = message.result.observation;
    if (
      (observation.kind === 'navigation' || observation.kind === 'interaction') &&
      !matchesOrigin(observation.currentUrl, message.allowedPreviewOrigin)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['result', 'observation', 'currentUrl'],
        message: 'Observation URL must match the lease origin',
      });
    }
  });

export const loopBrowserCloseMessageSchema = z
  .object({
    type: z.literal('close'),
    ...loopBrowserLeaseShape,
    reason: loopBrowserCloseReasonSchema,
  })
  .strict();

export const loopBrowserClosedMessageSchema = z
  .object({
    type: z.literal('closed'),
    ...loopBrowserLeaseShape,
    reason: loopBrowserCloseReasonSchema,
    partitionDataCleared: z.boolean(),
    cleanupError: z.string().max(2048).optional(),
    closedAt: timestampSchema,
  })
  .strict();

export const loopBrowserMessageSchema = z.union([
  loopBrowserRequestMessageSchema,
  loopBrowserReadyMessageSchema,
  loopBrowserActionMessageSchema,
  loopBrowserResultMessageSchema,
  loopBrowserCloseMessageSchema,
  loopBrowserClosedMessageSchema,
]);

export type LoopBrowserLease = z.infer<typeof loopBrowserLeaseSchema>;
export type LoopBrowserTarget = z.infer<typeof loopBrowserTargetSchema>;
export type LoopBrowserAction = z.infer<typeof loopBrowserActionSchema>;
export type LoopBrowserObservation = z.infer<typeof loopBrowserObservationSchema>;
export type LoopBrowserActionResult = z.infer<typeof loopBrowserActionResultSchema>;
export type LoopBrowserRequestMessage = z.infer<typeof loopBrowserRequestMessageSchema>;
export type LoopBrowserReadyMessage = z.infer<typeof loopBrowserReadyMessageSchema>;
export type LoopBrowserActionMessage = z.infer<typeof loopBrowserActionMessageSchema>;
export type LoopBrowserResultMessage = z.infer<typeof loopBrowserResultMessageSchema>;
export type LoopBrowserCloseMessage = z.infer<typeof loopBrowserCloseMessageSchema>;
export type LoopBrowserClosedMessage = z.infer<typeof loopBrowserClosedMessageSchema>;
export type LoopBrowserMessage = z.infer<typeof loopBrowserMessageSchema>;
