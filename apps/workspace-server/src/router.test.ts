import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { router } from './router';

describe('router', () => {
  it('health returns ok status', async () => {
    const result = await call(router.health, {});
    expect(result.status).toBe('ok');
    expect(typeof result.version).toBe('string');
    expect(typeof result.uptimeMs).toBe('number');
    expect(result.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});
