/**
 * Monaco Editor diff color constants
 * Shared Monaco Editor diff color constants used by DiffViewer and other diff views
 * Colors are defined here for maintainability and consistency
 */

export const MONACO_DIFF_COLORS = {
  dark: {
    editorBackground: '#1e293b', // slate-800 dark grey/blue
    // Emerald (green) for additions - emerald-900 at 30% opacity
    insertedTextBackground: '#064e3b4D', // emerald-900 (#064e3b) with 30% opacity
    insertedLineBackground: '#064e3b66', // emerald-900 with 40% opacity for lines
    // Rose (red) for deletions - rose-900 at 30% opacity
    removedTextBackground: '#8813374D', // rose-900 (#881337) with 30% opacity
    removedLineBackground: '#88133766', // rose-900 with 40% opacity for lines
  },
  'dark-black': {
    editorBackground: '#000000', // pure black
    // Emerald (green) for additions with adjusted opacity for black background
    insertedTextBackground: '#064e3b5C', // emerald-900 with slightly higher opacity for black bg
    insertedLineBackground: '#064e3b73', // emerald-900 with 45% opacity for lines
    // Rose (red) for deletions with adjusted opacity for black background
    removedTextBackground: '#8813375C', // rose-900 with slightly higher opacity for black bg
    removedLineBackground: '#88133773', // rose-900 with 45% opacity for lines
  },
  light: {
    editorBackground: '#f8fafc', // slate-50 - light grey/white background
    // Emerald (green) for additions - emerald-50
    insertedTextBackground: '#10b98140', // emerald-500 with 25% opacity for subtle text highlight
    insertedLineBackground: '#ecfdf580', // emerald-50 (#ecfdf5) with 50% opacity for line background
    // Rose (red) for deletions - rose-50
    removedTextBackground: '#f43f5e40', // rose-500 with 25% opacity for subtle text highlight
    removedLineBackground: '#fff1f280', // rose-50 (#fff1f2) with 50% opacity for line background
  },
} as const;
