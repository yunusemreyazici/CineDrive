import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { envSchema, type EnvConfig } from '@cinedrive/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(process.cwd(), '.env.example'),
  path.resolve(process.cwd(), '../../.env.example'),
  path.resolve(__dirname, '../../../.env.example'),
  path.resolve(__dirname, '../../../../.env.example'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const parseEnv = (): EnvConfig => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Environment variable validation failed');
  }
  return result.data;
};

export const env = parseEnv();
