import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Controller } from '../api';
import { compose, type Middleware } from './compose';

describe('compose', () => {
  it('returns the target when no middlewares are provided', () => {
    const handler = vi.fn((value: number) => value + 1);

    expect(compose(handler, [])).toBe(handler);
  });

  it('runs the first middleware as the outermost wrapper', () => {
    const events: string[] = [];
    const handler = (value: string) => {
      events.push('handler');
      return value.toUpperCase();
    };
    const outer: Middleware<typeof handler> = (next) => (value) => {
      events.push('outer:before');
      const result = next(value);
      events.push('outer:after');
      return result;
    };
    const inner: Middleware<typeof handler> = (next) => (value) => {
      events.push('inner:before');
      const result = next(value);
      events.push('inner:after');
      return result;
    };

    const composed = compose(handler, [outer, inner]);

    expect(composed('wire')).toBe('WIRE');
    expect(events).toEqual([
      'outer:before',
      'inner:before',
      'handler',
      'inner:after',
      'outer:after',
    ]);
  });

  it('does not mutate the middleware array', () => {
    const handler = (value: number) => value;
    const middleware: Middleware<typeof handler> = (next) => next;
    const middlewares = [middleware] as const;

    compose(handler, middlewares);

    expect(middlewares).toEqual([middleware]);
  });

  it('preserves function target types', () => {
    const handler = (input: { id: string }, _meta: { signal?: AbortSignal }) => input.id;
    const middleware: Middleware<typeof handler> = (next) => (input, _meta) => next(input, _meta);

    const composed = compose(handler, [middleware]);

    expectTypeOf(composed).toEqualTypeOf<typeof handler>();
    expect(composed({ id: 'same' }, {})).toBe('same');
  });

  it('works with controller object targets', async () => {
    const controller: Controller = {
      call: vi.fn(async (_path, input) => input),
      resolveLive: () => null,
      acquireLive: () => null,
      dispose: vi.fn(async () => {}),
    };
    const middleware: Middleware<Controller> = (next) => ({
      ...next,
      async call(path, input, meta) {
        return await next.call(path, { wrapped: input }, meta);
      },
    });

    const composed = compose(controller, [middleware]);

    await expect(composed.call('echo', 'value')).resolves.toEqual({ wrapped: 'value' });
    expect(controller.call).toHaveBeenCalledWith('echo', { wrapped: 'value' }, undefined);
  });
});
