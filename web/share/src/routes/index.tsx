import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  server: {
    handlers: {
      GET: () => Response.redirect('https://emdash.sh', 302),
    },
  },
});
