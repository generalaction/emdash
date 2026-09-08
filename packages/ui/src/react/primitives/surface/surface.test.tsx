/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { surface } from '../../../styles/recipes/surface';
import { Surface } from './surface';

afterEach(cleanup);

describe('Surface', () => {
  it('delegates its visual axes and root className to the public Surface Recipe', () => {
    const { container } = render(
      <Surface
        as="section"
        level="raised"
        tone="warning"
        className="caller-owned"
        data-testid="surface"
      />
    );
    const root = container.firstElementChild;

    expect(root?.tagName).toBe('SECTION');
    expect(root?.classList.contains('caller-owned')).toBe(true);
    for (const className of surface({ level: 'raised', tone: 'warning' }).split(' ')) {
      expect(root?.classList.contains(className)).toBe(true);
    }
  });

  it('uses paper as a Surface Role without leaking it to the DOM accessibility role', () => {
    const { container } = render(<Surface role="paper" />);
    const root = container.firstElementChild;

    expect(root?.getAttribute('role')).toBeNull();
    for (const className of surface({ role: 'paper' }).split(' ')) {
      expect(root?.classList.contains(className)).toBe(true);
    }
  });

  it('preserves an ARIA role when another Surface axis establishes the visual context', () => {
    const { container } = render(<Surface role="alert" tone="info" />);

    expect(container.firstElementChild?.getAttribute('role')).toBe('alert');
  });
});

// @ts-expect-error Surface requires a Level, Role, Tone, or context-relative emphasis.
const emptySurface = <Surface />;
void emptySurface;
