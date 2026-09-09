/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { Alert } from '..';

describe('Alert icon ownership', () => {
  it('renders opaque caller icons through the decorative IconSlot seam', () => {
    const callerIcon = <svg data-testid="caller-icon" width="48" height="32" />;
    const { getByTestId } = render(
      <Alert.Root status="info" icon={callerIcon}>
        Message
      </Alert.Root>
    );

    const icon = getByTestId('caller-icon');
    const slot = icon.parentElement;

    expect(slot?.getAttribute('data-slot')).toBe('icon-slot');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('width')).toBe('48');
    expect(icon.getAttribute('height')).toBe('32');
  });
});
