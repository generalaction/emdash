// Runtime entry that installs path aliases for compiled JS before loading the app.
// This avoids '@shared/*' resolution failures in the compiled Electron main process.
// We point aliases to the compiled dist tree rather than TS sources.
import path from 'node:path';

try {
  // Register only the aliases we actually use in main.
  // __dirname here resolves to dist/main/main at runtime.
  // baseUrl => dist/main, so '@shared/*' -> dist/main/shared/*
  // and '@/*' -> dist/main/main/* (optional, for convenience)
  // Use dynamic import to avoid bundling surprises.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsconfigPaths = require('tsconfig-paths');
  tsconfigPaths.register({
    baseUrl: path.join(__dirname, '..'),
    paths: {
      '@shared/*': ['shared/*'],
      '@/*': ['main/*'],
    },
  });
} catch {}

// Load the actual application bootstrap
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./main');
