// Allow side-effect CSS imports in stories without TypeScript errors.
// Vite handles these at build/Storybook time; tsc only type-checks the JS/TS shape.
declare module '*.css' {}
declare module 'devicon/devicon.min.css' {}
