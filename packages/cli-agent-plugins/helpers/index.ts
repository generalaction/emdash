export * from './command-builder';
export * from './config';
export * from './file-drop';
export * from './hierarchical';
export * from './hook-config';
export * from './hooks';
// helpers/icon.tsx is NOT exported here — impl plugins import it directly
// to avoid mixing JSX/React into the non-JSX main package barrel.
export * from './mcp';
export * from './merge';
export * from './standard-command';
