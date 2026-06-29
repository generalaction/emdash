import { rmSync } from 'node:fs';

// Cross-platform replacement for `rm -rf node_modules dist`, which only ran on
// POSIX shells. `rmSync` with recursive+force is a no-op when a target is missing.
for (const target of ['node_modules', 'dist']) {
  rmSync(target, { recursive: true, force: true });
}
