import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createController } from '../api/controller';
import { defineContract, procedure } from '../api/define';
import { defineWireComponent } from './define';
import { requireContract } from './requirements';

const greetingContract = defineContract({
  greet: procedure({ input: z.object({ name: z.string() }), output: z.string() }),
});

describe('defineWireComponent', () => {
  it('creates an in-process instance with a typed client', async () => {
    const scope = createScope({ label: 'test' });
    let disposed = false;
    const component = defineWireComponent({
      id: 'greeter',
      contract: greetingContract,
      requirements: {},
      configSchema: z.object({ prefix: z.string() }),
      create: ({ config, instance, scope }) => {
        scope.add(() => {
          disposed = true;
        });
        return instance({
          scope,
          controller: createController(greetingContract, {
            greet: ({ name }) => `${config.prefix} ${name}`,
          }),
        });
      },
    });

    const created = component.create({
      scope,
      dependencies: {},
      config: { prefix: 'hello' },
    });

    await expect(created.client.greet({ name: 'wire' })).resolves.toBe('hello wire');
    await created.dispose();
    expect(disposed).toBe(true);
  });

  it('validates config before construction', () => {
    const scope = createScope({ label: 'test' });
    const component = defineWireComponent({
      id: 'greeter',
      contract: greetingContract,
      requirements: {},
      configSchema: z.object({ prefix: z.string() }),
      create: ({ instance, scope }) =>
        instance({
          scope,
          controller: createController(greetingContract, {
            greet: ({ name }) => name,
          }),
        }),
    });

    expect(() =>
      component.create({
        scope,
        dependencies: {},
        config: { prefix: 123 } as never,
      })
    ).toThrow();
  });

  it('requires exact dependency keys', () => {
    const scope = createScope({ label: 'test' });
    const component = defineWireComponent({
      id: 'dependent',
      contract: greetingContract,
      requirements: {
        greeter: requireContract(greetingContract),
      },
      configSchema: z.object({}),
      create: ({ instance, scope }) =>
        instance({
          scope,
          controller: createController(greetingContract, {
            greet: ({ name }) => name,
          }),
        }),
    });

    expect(() =>
      component.create({
        scope,
        dependencies: {} as never,
        config: {},
      })
    ).toThrow(/missing required dependencies/);
  });
});
