/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageLayout } from '.';

afterEach(cleanup);

describe('PageLayout public component APIs', () => {
  it('applies className to the rendered page and content roots', () => {
    const { container } = render(
      <PageLayout className="caller-page">
        <PageLayout.Content className="caller-content">Content</PageLayout.Content>
      </PageLayout>
    );

    expect(container.firstElementChild?.classList.contains('caller-page')).toBe(true);
    expect(screen.getByText('Content').classList.contains('caller-content')).toBe(true);
  });

  it.each([false, true])(
    'keeps className on the semantic header root when sticky is %s',
    (sticky) => {
      render(
        <PageLayout.Header
          title="Interface"
          description="Configure Emdash."
          sticky={sticky}
          className="caller-header"
        />
      );

      const header = screen.getByRole('banner');
      expect(header.classList.contains('caller-header')).toBe(true);
      expect(screen.getByRole('heading', { name: 'Interface' })).not.toBeNull();
    }
  );

  it('owns active and disabled navigation behavior', () => {
    const onSelect = vi.fn();
    render(
      <PageLayout.SidebarMenu
        activeId="general"
        onSelect={onSelect}
        items={[
          { id: 'general', label: 'General' },
          { id: 'unavailable', label: 'Unavailable', disabled: true },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe(
      'page'
    );
    const disabled = screen.getByRole('button', { name: 'Unavailable' });
    expect(disabled.hasAttribute('disabled')).toBe(true);
    fireEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
