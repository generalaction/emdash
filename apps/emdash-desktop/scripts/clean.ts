import { rmSync } from 'node:fs';

// Cross-platform replacement for `rm -rf node_modules dist`, which only ran on
// POSIX shells. The build output lives in `out/` (electron-vite default), not
// `dist/`, so wipe that. `rmSync` with recursive+force is a no-op when a target
// is missing.
for (const target of ['node_modules', 'out']) {
  rmSync(target, { recursive: true, force: true });
}
