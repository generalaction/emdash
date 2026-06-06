import { describe, expect, it } from 'vitest';
import { extractFilePathFromInlineCode } from './markdown-file-links';

describe('extractFilePathFromInlineCode', () => {
  it('matches bare and nested file paths', () => {
    expect(extractFilePathFromInlineCode('package.json')).toBe('package.json');
    expect(extractFilePathFromInlineCode('src/components/sidebar/sidebar.tsx')).toBe(
      'src/components/sidebar/sidebar.tsx'
    );
    expect(extractFilePathFromInlineCode('src-tauri/Cargo.toml')).toBe('src-tauri/Cargo.toml');
    expect(extractFilePathFromInlineCode('./relative/file.ts')).toBe('./relative/file.ts');
  });

  it('strips line and column suffixes', () => {
    expect(extractFilePathFromInlineCode('src/main.ts:42')).toBe('src/main.ts');
    expect(extractFilePathFromInlineCode('src/main.ts:42:7')).toBe('src/main.ts');
  });

  it('leaves commands, globs, routes, and prose alone', () => {
    expect(extractFilePathFromInlineCode('pnpm build')).toBeNull();
    expect(extractFilePathFromInlineCode('cargo check')).toBeNull();
    expect(extractFilePathFromInlineCode('src-tauri/*')).toBeNull();
    expect(extractFilePathFromInlineCode('/changelog')).toBeNull();
    expect(extractFilePathFromInlineCode('Connection::ping')).toBeNull();
    expect(extractFilePathFromInlineCode('0.0.1')).toBeNull();
    expect(extractFilePathFromInlineCode('')).toBeNull();
  });
});
