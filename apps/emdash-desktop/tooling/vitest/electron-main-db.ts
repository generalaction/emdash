// Main-db tests run under system Node and must inject any Electron-owned behavior.
// Undefined exports allow Electron-aware modules to feature-detect the unavailable runtime.
export const app = undefined;
export const safeStorage = undefined;
