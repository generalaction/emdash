/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import { Settings } from 'lucide-react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { Icon, IconSlot } from '..';

describe('Icon', () => {
  it('styles the owned SVG root and is decorative by default', () => {
    const ref = React.createRef<SVGSVGElement>();
    const { getByTestId } = render(
      <Icon
        ref={ref}
        source={Settings}
        size="lg"
        className="consumer-class"
        data-testid="icon"
        aria-label="Bypassed label"
      />
    );

    const icon = getByTestId('icon');
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.classList).toContain('consumer-class');
    expect(icon.getAttribute('class')).toContain('icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.hasAttribute('aria-label')).toBe(false);
    expect(icon.hasAttribute('role')).toBe(false);
    expect(ref.current).toBe(icon);
  });

  it('exposes a meaningful icon only through an explicit label', () => {
    const { getByRole } = render(<Icon source={Settings} label="Settings" />);

    const icon = getByRole('img', { name: 'Settings' });
    expect(icon.getAttribute('aria-label')).toBe('Settings');
    expect(icon.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('IconSlot', () => {
  it('keeps opaque icon markup intact inside a decorative slot', () => {
    const ref = React.createRef<HTMLSpanElement>();
    const { getByTestId } = render(
      <IconSlot ref={ref} size="sm" className="consumer-slot" data-testid="slot">
        <svg
          data-testid="opaque-icon"
          width="64"
          height="32"
          aria-label="Vendor status"
          role="img"
        />
      </IconSlot>
    );

    const slot = getByTestId('slot');
    const child = getByTestId('opaque-icon');
    expect(slot.tagName.toLowerCase()).toBe('span');
    expect(slot.classList).toContain('consumer-slot');
    expect(slot.getAttribute('data-slot')).toBe('icon-slot');
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(slot.firstElementChild).toBe(child);
    expect(child.getAttribute('width')).toBe('64');
    expect(child.getAttribute('height')).toBe('32');
    expect(child.getAttribute('aria-label')).toBe('Vendor status');
    expect(ref.current).toBe(slot);
  });
});

function verifyIconTypes(): void {
  <Icon source={Settings} />;
  <IconSlot size="xs">{<svg />}</IconSlot>;
  // @ts-expect-error Runtime name lookup is not part of the owned Icon contract.
  <Icon name="settings" />;
  // @ts-expect-error Semantic tone belongs to a parent Recipe or specialized component.
  <Icon source={Settings} tone="destructive" />;
  // @ts-expect-error The owned source, not arbitrary descendants, provides SVG content.
  <Icon source={Settings}>{<path />}</Icon>;
  // @ts-expect-error IconSlot requires opaque child content.
  <IconSlot />;
}

void verifyIconTypes;
