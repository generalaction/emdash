type CreatePrBodyPlanArgs = {
  fill?: boolean;
  title?: string;
  rawBody?: string;
  enrichedBody?: string;
};

export type CreatePrBodyPlan = {
  shouldPatchFilledBody: boolean;
  shouldUseBodyFile: boolean;
  shouldUseFill: boolean;
};

export function getCreatePrBodyPlan(args: CreatePrBodyPlanArgs): CreatePrBodyPlan {
  const { fill, title, rawBody, enrichedBody } = args;

  // When fill is requested with no explicit body, footer-only content must be
  // applied after creation so gh can keep its fill-generated body.
  const shouldPatchFilledBody = Boolean(fill && !rawBody && enrichedBody);
  const shouldUseBodyFile = Boolean(enrichedBody && !shouldPatchFilledBody);

  // Use fill when caller requested it and either:
  // - we need to patch footer after gh generates body, or
  // - title/body are missing and gh should infer them.
  const shouldUseFill = Boolean(fill && (shouldPatchFilledBody || !title || !enrichedBody));

  return { shouldPatchFilledBody, shouldUseBodyFile, shouldUseFill };
}
