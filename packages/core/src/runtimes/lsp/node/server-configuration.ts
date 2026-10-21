import { z } from 'zod';

/** Server-to-client policy, kept separate from stdio and child-process lifetime. */
export function createServerRequestHandlers(
  rootUri: string,
  settings: Record<string, unknown> = {}
) {
  return {
    'workspace/configuration': (params: unknown): unknown => {
      const parsed = z
        .object({ items: z.array(z.object({ section: z.string().optional() })) })
        .safeParse(params);
      return parsed.success
        ? parsed.data.items.map(({ section }) => sectionValue(settings, section))
        : [];
    },
    'workspace/workspaceFolders': () => [{ uri: rootUri, name: 'workspace' }],
    'workspace/applyEdit': () => ({
      applied: false,
      failureReason: 'Workspace edits are not supported by this client.',
    }),
    'window/workDoneProgress/create': () => null,
    'window/showMessageRequest': () => null,
  };
}

function sectionValue(settings: Record<string, unknown>, section?: string): unknown {
  if (!section) return settings;
  let value: unknown = settings;
  for (const key of section.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value ?? null;
}
