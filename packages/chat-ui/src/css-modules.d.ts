// Provides CSS module type declarations for TypeScript and vite-plugin-dts.
// The vite/client reference alone is not sufficient when tsconfig sets
// an explicit "types" array that does not include "vite/client".
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
