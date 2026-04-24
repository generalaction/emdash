import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders links via asChild', () => {
    render(
      <Badge asChild>
        <a href="https://www.emdash.sh/">Try Emdash v1</a>
      </Badge>
    );

    const link = screen.getByRole('link', { name: 'Try Emdash v1' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://www.emdash.sh/');
    expect(link).toHaveClass('inline-flex');
  });
});
