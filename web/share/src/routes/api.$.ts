import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import app from '../server/hono-app';

const forwardToHono = ({ request }: { request: Request }) => app.fetch(request, env);

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: forwardToHono,
      POST: forwardToHono,
    },
  },
});
