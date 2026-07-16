import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/runtimes/automations/node/sqlite/schema.ts',
  out: './src/runtimes/automations/node/sqlite/migrations',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
});
