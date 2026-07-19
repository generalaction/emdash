import { describe, expect, it } from 'vitest';
import { desktopWireContract } from '../shared/desktop-wire-contract';
import { desktopNodeControllers } from './controllers';

describe('desktop node controller manifest', () => {
  it('provides exactly one controller for every desktop wire domain', () => {
    expect(Object.keys(desktopNodeControllers).sort()).toEqual(
      Object.keys(desktopWireContract).sort()
    );
  });

  it('uses the exact contract entry exposed to the renderer', () => {
    for (const [domain, contribution] of Object.entries(desktopNodeControllers)) {
      expect(contribution.contract, domain).toBe(
        desktopWireContract[domain as keyof typeof desktopWireContract]
      );
    }
  });
});
