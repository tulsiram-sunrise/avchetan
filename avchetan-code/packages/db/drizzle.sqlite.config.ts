import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/sqlite/tables.ts',
  out: './migrations/sqlite',
});
