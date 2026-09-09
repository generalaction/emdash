import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '../..');

describe('@emdash/ui Chat host ownership boundary', () => {
  it('does not publish or implement a product-specific Chat Host Adapter', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const buildScript = readFileSync(resolve(packageRoot, 'scripts/build-library.ts'), 'utf8');

    expect(packageJson.exports).not.toHaveProperty('./react/chat-ui/host-adapter');
    expect(buildScript).not.toContain("'react/chat-ui/host-adapter'");
    expect(existsSync(resolve(packageRoot, 'src/react/chat-ui/chat-host-adapter.css.ts'))).toBe(
      false
    );
    expect(existsSync(resolve(packageRoot, 'src/react/chat-ui/chat-host-contract.ts'))).toBe(false);
  });
});
