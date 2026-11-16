import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().optional(),
  AUTH_SECRET: z.string().default('vajra_dev_secret_key_12345'),
  DEFAULT_ACCOUNT_ID: z.string().default('acme-cooling-in'),
  DEFAULT_USER_ID: z.string().default('u_demo_planner'),

  // Config-driven Reference Date
  SIMULATED_CURRENT_DATE: z.string().default('2026-11-15'),

  // Config-driven Quality & Threshold Rules
  DEFAULT_MIN_IMPRESSIONS: z.coerce.number().default(1000),
  DEFAULT_CTR_ISSUE_THRESHOLD: z.coerce.number().default(-20.0),
  DEFAULT_CPC_ISSUE_THRESHOLD: z.coerce.number().default(30.0),
  DEFAULT_BUDGET_WARNING_THRESHOLD: z.coerce.number().default(0.85),
  ALERT_COOLDOWN_HOURS: z.coerce.number().default(24),

  // Mailer
  MAILER_DRIVER: z.enum(['log', 'mailhog', 'smtp']).default('log'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_FROM: z.string().default('governance@vajra.example'),

  // Config-driven Simulation Injections
  SIMULATE_GOOGLE_DELAY: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  SIMULATE_CAMPAIGN_FAILED_SYNC_ID: z.coerce.number().default(27),
  SIMULATE_CAMPAIGN_DELAYED_SYNC_ID: z.coerce.number().default(6),
  SIMULATE_CAMPAIGN_NO_AD_SETS_ID: z.coerce.number().default(26),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);
