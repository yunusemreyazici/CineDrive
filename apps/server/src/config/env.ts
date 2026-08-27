import path from 'path';
import { fileURLToPath } from 'url';
import { envSchema, type EnvConfig } from '@cinedrive/shared';
import { loadDotenvFiles } from './dotenv-loader.js';

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

loadDotenvFiles(envPaths);

const parseEnv = (): EnvConfig => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Environment variable validation failed');
  }

  const parsed = result.data;

  // Strict production secrets validation
  if (parsed.NODE_ENV === 'production') {
    if (parsed.SESSION_SECRET.includes('super-secret-session-key')) {
      throw new Error('FATAL: Default SESSION_SECRET cannot be used in production environment!');
    }
    if (parsed.TOKEN_ENCRYPTION_KEY.length !== 64) {
      throw new Error('FATAL: TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)!');
    }
  }

  return parsed;
};

export const env = parseEnv();
