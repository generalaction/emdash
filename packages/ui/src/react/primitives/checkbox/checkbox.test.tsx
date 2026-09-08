/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from '..';

describe('Checkbox icon ownership', () => {
  it('keeps its owned checkmark decorative', () => {
    const { getByRole } = render(<Checkbox aria-label="Include files" defaultChecked />);

    const icon = getByRole('checkbox', { name: 'Include files' }).querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.classList.contains('lucide')).toBe(true);
    expect([...icon!.classList].some((className) => !className.startsWith('lucide'))).toBe(true);
  });
});
