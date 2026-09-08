/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import { AlertTriangleIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { StatusIcon } from './status-icon';

describe('StatusIcon', () => {
  it('composes the semantic badge with an owned decorative Icon', () => {
    const { container } = render(<StatusIcon severity="warning" size="lg" />);

    const badge = container.firstElementChild;
    const icon = badge?.firstElementChild;

    expect(badge?.getAttribute('data-severity')).toBe('warning');
    expect(badge?.getAttribute('data-size')).toBe('lg');
    expect(icon?.tagName.toLowerCase()).toBe('svg');
    expect(icon?.getAttribute('class')).toContain('icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies Icon ownership directly to a custom static source', () => {
    const { container } = render(
      <StatusIcon severity="error" icon={AlertTriangleIcon} data-testid="status" />
    );

    const icon = container.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('icon');
    expect(icon?.parentElement).toBe(container.firstElementChild);
  });
});
