import { describe, expect, it } from 'vitest';
import { resolveMarkdownImagePath } from './markdown-image-path';

describe('resolveMarkdownImagePath', () => {
  it('resolves relative image paths from the markdown file directory', () => {
    expect(resolveMarkdownImagePath('docs/readme.md', 'images/logo.png')).toBe(
      'docs/images/logo.png'
    );
  });

  it('resolves root-anchored image paths from the workspace root', () => {
    expect(resolveMarkdownImagePath('docs/readme.md', '/assets/logo.png')).toBe('/assets/logo.png');
  });

  it('rejects paths that escape the workspace root', () => {
    expect(resolveMarkdownImagePath('readme.md', '../logo.png')).toBeNull();
  });

  it('ignores external or special image sources', () => {
    expect(resolveMarkdownImagePath('readme.md', 'https://example.com/logo.png')).toBeNull();
    expect(resolveMarkdownImagePath('readme.md', '//cdn.example.com/logo.png')).toBeNull();
    expect(resolveMarkdownImagePath('readme.md', '#local-anchor')).toBeNull();
  });
});
