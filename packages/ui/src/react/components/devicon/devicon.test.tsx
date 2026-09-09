/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Devicon } from './devicon';

describe('Devicon', () => {
  it('contains the foreign glyph beneath an owned, decorative root', () => {
    const { container } = render(
      <Devicon iconClass="devicon-typescript-plain colored" size={14} className="consumer" />
    );

    const root = container.firstElementChild as HTMLElement;
    const glyph = root.firstElementChild;

    expect(root.getAttribute('data-foreign-adapter')).toBe('devicon');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.classList).toContain('consumer');
    expect(root.style.getPropertyValue('--_devicon-size')).toBe('14px');
    expect(root.getAttribute('style')).not.toContain('--em-');
    expect(glyph?.tagName.toLowerCase()).toBe('i');
    expect(glyph?.classList).toContain('devicon-typescript-plain');
    expect(glyph?.classList).toContain('colored');
  });

  it('exposes an explicit accessible label when the glyph carries meaning', () => {
    const { getByRole } = render(
      <Devicon iconClass="devicon-typescript-plain" label="TypeScript" />
    );

    expect(getByRole('img', { name: 'TypeScript' })).not.toBeNull();
  });
});
