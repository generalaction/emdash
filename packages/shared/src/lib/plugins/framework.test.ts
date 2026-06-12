import { describe, expect, it } from 'vitest';
import z from 'zod';
import { definePluginAsset } from './asset';
import { definePluginCapability } from './capability';
import { createPluginFramework } from './framework';

type ITestHooksBehavior = {
  readHooks(): Promise<string[]>;
};

const hooksCapability = definePluginCapability<ITestHooksBehavior>()(
  'hooks',
  z.object({
    kind: z.enum(['supported', 'none']),
  })
);

const autoApproveCapability = definePluginCapability()(
  'auto-approve',
  z.object({
    kind: z.enum(['supported', 'none']),
  })
);

const iconAsset = definePluginAsset(
  'icon',
  z.object({
    kind: z.literal('svg'),
    light: z.string(),
    dark: z.string().optional(),
  })
);

const capabilities = { hooks: hooksCapability, autoApprove: autoApproveCapability } as const;
const assets = { icon: iconAsset } as const;

const metadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const { definePlugin, registerPluginBehavior } = createPluginFramework(
  capabilities,
  metadataSchema,
  assets
);

function defineValidPlugin() {
  return definePlugin(
    { id: 'test-agent', name: 'Test Agent' },
    { hooks: { kind: 'supported' }, autoApprove: { kind: 'none' } },
    { icon: { kind: 'svg', light: '<svg></svg>' } }
  );
}

describe('createPluginFramework', () => {
  it('defines a plugin carrying metadata, capability descriptors, and assets', () => {
    const plugin = defineValidPlugin();

    expect(plugin.metadata.id).toBe('test-agent');
    expect(plugin.capabilities.hooks).toEqual({ kind: 'supported' });
    expect(plugin.assets.icon).toEqual({ kind: 'svg', light: '<svg></svg>' });
  });

  it('validates a well-formed plugin without errors', () => {
    expect(defineValidPlugin().validate()).toEqual([]);
  });

  it('reports metadata schema violations', () => {
    const plugin = definePlugin(
      { id: '', name: 'Test Agent' },
      { hooks: { kind: 'supported' }, autoApprove: { kind: 'none' } },
      { icon: { kind: 'svg', light: '<svg></svg>' } }
    );

    expect(plugin.validate()).toHaveLength(1);
  });

  it('reports capability and asset descriptor violations', () => {
    const plugin = definePlugin(
      { id: 'test-agent', name: 'Test Agent' },
      // Force malformed descriptors past the compile-time types.
      { hooks: { kind: 'bogus' } as never, autoApprove: { kind: 'none' } },
      { icon: { kind: 'svg', light: 123 } as never }
    );

    expect(plugin.validate()).toHaveLength(2);
  });

  it('attaches behavior bundles for capabilities that declare one', async () => {
    const provider = registerPluginBehavior(defineValidPlugin(), {
      hooks: { readHooks: async () => ['stop'] },
    });

    await expect(provider.behavior.hooks?.readHooks()).resolves.toEqual(['stop']);
  });
});
