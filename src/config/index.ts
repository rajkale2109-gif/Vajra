import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().optional().default(''),

  // Auth & Security
  AUTH_SECRET: z.string().default('vajra_dev_secret_key_12345'),
  DEFAULT_ACCOUNT_ID: z.string().default('acme-cooling-in'),
  DEFAULT_USER_ID: z.string().default('u_demo_planner'),

  // Reference Date & Pacing (ISO YYYY-MM-DD; if empty, uses today)
  SIMULATED_CURRENT_DATE: z.string().default('2026-11-15'),

  // Config-driven Threshold Rules
  DEFAULT_MIN_IMPRESSIONS: z.coerce.number().default(1000),
  DEFAULT_CTR_ISSUE_THRESHOLD: z.coerce.number().default(-20.0),
  DEFAULT_CPC_ISSUE_THRESHOLD: z.coerce.number().default(30.0),
  DEFAULT_BUDGET_WARNING_THRESHOLD: z.coerce.number().default(0.85),
  ALERT_COOLDOWN_HOURS: z.coerce.number().default(24),

  // Success-metric decision thresholds (proposed initial thresholds, not benchmarks)
  FALSE_POSITIVE_RATE_LIMIT: z.coerce.number().default(40),
  ALERT_ACTION_RATE_FLOOR: z.coerce.number().default(15),
  WORKFLOW_ADOPTION_FLOOR: z.coerce.number().default(20),
  EXPORT_REDUCTION_TARGET: z.coerce.number().default(30),
  // Pre-launch baseline of morning CSV exports per week (unset until measured)
  EXPORT_BASELINE_PER_WEEK: z.coerce.number().optional(),
  // 'simulated' runs the clock from SIMULATED_CURRENT_DATE 09:00; 'real' uses wall-clock time
  CLOCK_MODE: z.enum(['simulated', 'real']).default('simulated'),

  // Mailer
  MAILER_DRIVER: z.enum(['log', 'mailhog', 'smtp']).default('log'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  SMTP_FROM: z.string().default('governance@vajra.example'),

  // Simulated Platform Injections
  SIMULATE_GOOGLE_DELAY: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  SIMULATE_CAMPAIGN_FAILED_SYNC_ID: z.coerce.number().default(27),
  SIMULATE_CAMPAIGN_DELAYED_SYNC_ID: z.coerce.number().default(6),
  SIMULATE_CAMPAIGN_NO_AD_SETS_ID: z.coerce.number().default(26),

  // Optional Live Meta / Google Credentials (if provided, connectors run in live mode)
  META_ACCESS_TOKEN: z.string().optional(),
  META_AD_ACCOUNT_ID: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_ADS_CUSTOMER_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);
