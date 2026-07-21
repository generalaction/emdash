type ModelCatalog = Record<string, { aliases?: string[] }>;

export function resolveInitialModelOption(
  requestedModel: string,
  availableModels: readonly string[],
  catalog?: ModelCatalog
) {
  if (availableModels.includes(requestedModel)) return requestedModel;
  if (!catalog) return null;

  const catalogEntry =
    catalog[requestedModel] ??
    Object.values(catalog).find((option) => option.aliases?.includes(requestedModel));
  if (!catalogEntry) return null;

  return catalogEntry.aliases?.find((alias) => availableModels.includes(alias)) ?? null;
}
