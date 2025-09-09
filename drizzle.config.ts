import { defineConfig } from 'drizzle-kit';

const DEFAULT_PG_URL = `postgres://eliza:password@localhost:${process.env.POSTGRES_DEV_PORT || 5439}/eliza`;
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.POSTGRES_DATABASE_URL || DEFAULT_PG_URL;
const USE_SQLITE = process.env.DRIZZLE_SQLITE === 'true';

export default defineConfig(
  USE_SQLITE
    ? {
        schema: './src/db/sqlite-schema.ts',
        out: './drizzle',
        dialect: 'sqlite',
        dbCredentials: {
          url: './data/eliza-otc.db',
        },
      }
    : {
        schema: './src/db/schema.ts',
        out: './drizzle',
        dialect: 'postgresql',
        dbCredentials: {
          url: POSTGRES_URL,
        },
      }
);
