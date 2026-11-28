import type { PluginIconAsset } from '@emdash/shared/plugins';

// The Pydantic mark in Lithium, as drawn by Pax's web UI
// (`src/pydantic_ai_pax/web-ui/src/components/Logo.tsx` in pydantic/pydantic-ai).
export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'Pax',
  variants: [
    {
      minSize: 0,
      light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -13.2 146.4 146.4"><title>Pax</title><path fill="#e520e9" d="M137.385 90.65 73.515 2.075c-2.01-2.765-6.645-2.765-8.635 0L1.01 90.65a5.335 5.335 0 0 0 2.65 8.175l63.87 20.91h.01a5.303 5.303 0 0 0 3.3 0h.01l63.87-20.91a5.278 5.278 0 0 0 3.4-3.415 5.263 5.263 0 0 0-.75-4.76h.015ZM69.2 14.28l25.6 35.505-23.94-7.835c-.185-.06-.38-.05-.565-.095a3.502 3.502 0 0 0-.55-.09c-.185-.025-.36-.095-.545-.095-.185 0-.355.07-.54.095a4.245 4.245 0 0 0-.55.09c-.19.035-.385.035-.555.095L43.76 49.74l-.15.05 25.6-35.51h-.01ZM33.03 64.45l27.87-9.13 2.975-.97v52.99l-49.97-16.365L33.03 64.45Zm41.5 42.88V54.35l30.845 10.1L124.5 90.96l-49.975 16.37h.005Z"/></svg>`,
    },
  ],
};
