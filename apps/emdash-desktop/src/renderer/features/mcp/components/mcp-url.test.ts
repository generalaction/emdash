import { describe, expect, it } from 'vitest';
import { normalizeMcpUrl } from './mcp-url';

describe('normalizeMcpUrl', () => {
  it('treats trailing slashes on server paths as equivalent', () => {
    expect(normalizeMcpUrl('https://mcp.example.com/mcp')).toBe(
      normalizeMcpUrl('https://mcp.example.com/mcp/')
    );
  });

  it('preserves root URLs', () => {
    expect(normalizeMcpUrl('https://mcp.example.com')).toBe('https://mcp.example.com/');
  });
});
