import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Client generation does not connect to the database, so keep it usable in a
// clean checkout where DATABASE_URL has not been configured yet. Deploy and
// migration commands still receive the real URL from their environment.
const databaseUrl = process.env.DATABASE_URL ?? 'file:./data/app.db';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
