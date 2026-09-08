/**
 * Ambient type declaration for plain CSS file imports.
 *
 * Allows TypeScript to accept side-effect imports of plain .css files
 * in infrastructure and host entrypoints. The UI library's Rollup build
 * produces the self-contained `dist/styles.css`; Vite remains responsible
 * only for application development and Storybook consumption.
 */
declare module '*.css' {
  const classes: Record<string, string>;
  export = classes;
}
