import { defineConfig } from 'prisma/config';

const schema = process.env.CINEDRIVE_MIGRATION_TEST_SCHEMA;
const migrations = process.env.CINEDRIVE_MIGRATION_TEST_MIGRATIONS;
const databaseUrl = process.env.DATABASE_URL;

if (!schema || !migrations || !databaseUrl) {
  throw new Error(
    'Migration test config requires CINEDRIVE_MIGRATION_TEST_SCHEMA, CINEDRIVE_MIGRATION_TEST_MIGRATIONS, and DATABASE_URL.',
  );
}

export default defineConfig({
  schema,
  migrations: { path: migrations },
  datasource: { url: databaseUrl },
});
