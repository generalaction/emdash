/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { Kbd } from '..';

describe('Kbd icon ownership', () => {
  it('renders opaque icon content through its decorative icon slot', () => {
    const { getByTestId } = render(
      <Kbd icon>
        <svg data-testid="shortcut-icon" width="32" height="24" />
      </Kbd>
    );

    const icon = getByTestId('shortcut-icon');
    expect(icon.parentElement?.getAttribute('data-slot')).toBe('icon-slot');
    expect(icon.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('width')).toBe('32');
    expect(icon.getAttribute('height')).toBe('24');
  });
});
