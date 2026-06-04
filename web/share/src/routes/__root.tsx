import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { NotFound } from '../components/NotFound';
import appCss from '../styles/app.css?url';

// The em-dash mark from the wordmark as a scheme-aware SVG favicon.
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-13.24 -27.81 130 130">' +
    '<style>path{fill:#202020}@media(prefers-color-scheme:dark){path{fill:#eeeeee}}</style>' +
    '<path d="M23.235 23.2454H103.519L80.2841 51.1252H0L23.235 23.2454Z"/>' +
    '</svg>'
)}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: FAVICON },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
