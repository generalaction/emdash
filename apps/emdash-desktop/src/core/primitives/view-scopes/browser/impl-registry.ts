import type { ViewScopeDefinition, ViewScopeImpl } from '@core/primitives/view-scopes/api';

const implementations = new Map<ViewScopeDefinition, unknown>();

export function assertImplHasAllCommands(
  definition: ViewScopeDefinition,
  implementation: unknown
): void {
  const record =
    implementation !== null && typeof implementation === 'object'
      ? (implementation as Readonly<Record<string, unknown>>)
      : {};
  const missing = definition.commands
    .filter((command) => typeof record[command.id] !== 'function')
    .map((command) => command.id);
  if (missing.length > 0) {
    throw new Error(
      `View scope implementation ${definition.id} is missing command bindings: ${missing.join(', ')}`
    );
  }
}

export function registerViewScopeImpl<TDef extends ViewScopeDefinition>(
  definition: TDef,
  implementation: ViewScopeImpl<TDef>
): void {
  if (implementations.has(definition)) {
    throw new Error(`Duplicate view scope implementation: ${definition.id}`);
  }
  assertImplHasAllCommands(definition, implementation);
  implementations.set(definition, implementation);
}

export function getViewScopeImpl<TDef extends ViewScopeDefinition>(
  definition: TDef
): ViewScopeImpl<TDef> | undefined {
  return implementations.get(definition) as ViewScopeImpl<TDef> | undefined;
}

export function unregisterViewScopeImpl(definition: ViewScopeDefinition): void {
  implementations.delete(definition);
}

export function assertViewScopeImplsComplete(definitions: readonly ViewScopeDefinition[]): void {
  const missing = definitions
    .filter((definition) => definition.activation === 'logical')
    .filter((definition) => !implementations.has(definition))
    .map((definition) => definition.id);
  if (missing.length > 0) {
    throw new Error(`Missing view scope implementations: ${missing.join(', ')}`);
  }
}
