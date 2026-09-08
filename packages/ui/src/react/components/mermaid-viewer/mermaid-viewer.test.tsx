/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MermaidViewerDialog } from '.';

describe('MermaidViewerDialog', () => {
  it('roots generated diagram markup in its dedicated adapter', () => {
    const { baseElement } = render(
      <MermaidViewerDialog
        open
        onOpenChange={() => {}}
        svg="<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'/></svg>"
      />
    );

    const adapter = baseElement.querySelector('[data-foreign-adapter="generated-diagram"]');
    expect(adapter).not.toBeNull();
    expect(adapter?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
  });
});
