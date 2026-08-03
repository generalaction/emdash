import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/primitives/kernel/sqlite/schema.ts',
  out: './src/primitives/kernel/sqlite/migrations',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
});
