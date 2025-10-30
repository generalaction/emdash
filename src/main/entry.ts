// Runtime entry that installs path aliases for compiled JS before loading the app.
// This avoids '@shared/*' resolution failures in the compiled Electron main process.
// We point aliases to the compiled dist tree rather than TS sources.
import path from 'node:path';

// Install minimal path alias resolver without external deps.
// Maps:
//   @shared/* -> dist/main/shared/*
//   @/*      -> dist/main/main/*
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module');
  const base = path.join(__dirname, '..'); // dist/main
  const sharedBase = path.join(base, 'shared');
  const mainBase = path.join(base, 'main');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    if (typeof request === 'string') {
      if (request.startsWith('@shared/')) {
        const mapped = path.join(sharedBase, request.slice('@shared/'.length));
        return orig.call(this, mapped, parent, isMain, options);
      }
      if (request.startsWith('@/')) {
        const mapped = path.join(mainBase, request.slice('@/'.length));
        return orig.call(this, mapped, parent, isMain, options);
      }
    }
    return orig.call(this, request, parent, isMain, options);
  };
} catch {}

// Load the actual application bootstrap
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./main');
