// Centralized motion presets for menus/dropdowns
// Usage:
//   const mm = menuMotion(useReducedMotion())
//   <motion.div {...mm}>...</motion.div>

export function menuMotion(reduceMotion: boolean) {
  return {
    initial: reduceMotion ? false : { opacity: 0, y: 6, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduceMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 4, scale: 0.98 },
    transition: reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
  } as const;
}

