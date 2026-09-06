import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root when running from source, install root when running from dist. */
const appRoot = path.resolve(here, '..', '..');

const booleanish = z
  .string()
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** SQLite file. `:memory:` is honoured for tests. */
  DATABASE_PATH: z.string().default(path.join(appRoot, 'data', 'picalendar.sqlite')),

  /** IANA zone the wall display renders in — all day-bucketing uses this. */
  DISPLAY_TIMEZONE: z.string().default('UTC'),

  /** Directory of built frontend assets to serve; empty disables static hosting. */
  STATIC_DIR: z.string().default(path.join(appRoot, '..', 'frontend', 'dist')),
  SERVE_STATIC: booleanish.default('true'),

  /** Comma-separated origins allowed to call the API during development. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /** Background poller cadence — feeds are due based on their own interval. */
  SYNC_ENABLED: booleanish.default('true'),
  SYNC_TICK_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  SYNC_ON_STARTUP: booleanish.default('true'),
  /** Abort an ICS download that takes longer than this. */
  SYNC_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),

  /** Rolling window of materialised occurrences, relative to now. */
  OCCURRENCE_WINDOW_PAST_DAYS: z.coerce.number().int().min(0).max(365).default(14),
  OCCURRENCE_WINDOW_FUTURE_DAYS: z.coerce.number().int().min(7).max(1095).default(180),

  /** A sighting keeps someone "present" for this long. */
  PRESENCE_WINDOW_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),

  /** Shared secret for /api/admin/* and presence ingest; unset disables auth. */
  ADMIN_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  appRoot,
  database: {
    path: env.DATABASE_PATH,
  },
  display: {
    timezone: env.DISPLAY_TIMEZONE,
  },
  static: {
    enabled: env.SERVE_STATIC,
    dir: env.STATIC_DIR,
  },
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  sync: {
    enabled: env.SYNC_ENABLED,
    tickSeconds: env.SYNC_TICK_SECONDS,
    onStartup: env.SYNC_ON_STARTUP,
    timeoutMs: env.SYNC_TIMEOUT_MS,
    windowPastDays: env.OCCURRENCE_WINDOW_PAST_DAYS,
    windowFutureDays: env.OCCURRENCE_WINDOW_FUTURE_DAYS,
  },
  presence: {
    windowSeconds: env.PRESENCE_WINDOW_SECONDS,
  },
  adminToken: env.ADMIN_TOKEN?.trim() || null,
} as const;

export type Config = typeof config;
