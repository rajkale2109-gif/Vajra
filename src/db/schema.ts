import {
  pgTable,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  serial,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(), // e.g. 'acme-cooling-in'
  name: text('name').notNull(),
  currency: text('currency').default('INR').notNull(),
  timezone: text('timezone').default('Asia/Kolkata').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(), // e.g. 'u_demo_planner'
  accountId: text('account_id').references(() => accounts.id).notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').default('Media Planner').notNull(),
  avatarInitials: text('avatar_initials').default('PN').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const platformConnections = pgTable('platform_connections', {
  id: text('id').primaryKey(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  platform: text('platform').notNull(), // 'Meta' | 'Google'
  status: text('status').notNull(), // 'connected' | 'delayed' | 'failed'
  lastSuccessfulSyncAt: text('last_successful_sync_at'),
  syncMessage: text('sync_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const campaigns = pgTable('campaigns', {
  id: integer('id').primaryKey(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  rawName: text('raw_name').notNull(),
  displayName: text('display_name').notNull(),
  platform: text('platform').notNull(), // 'Meta' | 'Google'
  objective: text('objective').notNull(), // 'Awareness' | 'Traffic' | 'Engagement' | 'Leads' | 'App Promotion' | 'Sales'
  status: text('status').notNull(), // 'Active' | 'Learning' | 'Paused' | 'Ended'
  initialStatus: text('initial_status').notNull(),
  budget: integer('budget'),
  spent: integer('spent'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  learningFlag: boolean('learning_flag').default(false).notNull(),
  syncStatus: text('sync_status').default('ok').notNull(), // 'ok' | 'delayed' | 'insufficient' | 'noadsets' | 'failed'
  lastSyncedAt: text('last_synced_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const adSets = pgTable('ad_sets', {
  id: text('id').primaryKey(), // e.g. '0-1'
  campaignId: integer('campaign_id').references(() => campaigns.id).notNull(),
  name: text('name').notNull(),
  audience: text('audience').notNull(),
  status: text('status').notNull(), // 'Active' | 'Learning' | 'Paused' | 'Ended'
  initialStatus: text('initial_status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dailyMetrics = pgTable('daily_metrics', {
  id: serial('id').primaryKey(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  campaignId: integer('campaign_id').references(() => campaigns.id).notNull(),
  adSetId: text('ad_set_id'), // null for campaign-level metric row
  spend: numeric('spend'),
  impressions: integer('impressions'),
  clicks: integer('clicks'),
  reach: integer('reach'),
  engagements: integer('engagements'),
  conversions: integer('conversions'),
  revenue: numeric('revenue'),
  dataState: text('data_state').default('complete').notNull(), // 'complete' | 'partial' | 'delayed' | 'missing'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const groups = pgTable('groups', {
  id: text('id').primaryKey(), // e.g. 'g2'
  accountId: text('account_id').references(() => accounts.id).notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  updatedText: text('updated_text').default('Nov 15').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    id: serial('id').primaryKey(),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
    campaignId: integer('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('group_campaign_uniq').on(table.groupId, table.campaignId),
  ]
);

export const alertRules = pgTable('alert_rules', {
  id: text('id').primaryKey(), // e.g. 'a2'
  accountId: text('account_id').references(() => accounts.id).notNull(),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull(), // 'campaigns' | 'group' | 'adsets'
  entityIds: text('entity_ids').notNull(), // JSON serialized string of string/number IDs
  metric: text('metric').notNull(), // 'cpc' | 'ctr' | 'spend' | etc.
  condition: text('condition').notNull(), // 'drop' | 'rise' | 'below' | 'above'
  threshold: numeric('threshold').notNull(),
  comparisonPeriod: text('comparison_period').notNull(), // 'Previous day' | 'Previous 7 days' | 'Previous 30 days' | 'Custom comparison'
  recipient: text('recipient').notNull(),
  frequency: text('frequency').notNull(), // 'Immediate' | 'Daily summary'
  status: text('status').default('Active').notNull(), // 'Active' | 'Paused'
  lastTriggeredAt: text('last_triggered_at').default('—').notNull(),
  cooldownUntil: text('cooldown_until'),
  feedbackKey: text('feedback_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const alertTriggers = pgTable('alert_triggers', {
  id: serial('id').primaryKey(),
  ruleId: text('rule_id').references(() => alertRules.id, { onDelete: 'cascade' }).notNull(),
  triggerKey: text('trigger_key').notNull(),
  observedValue: numeric('observed_value').notNull(),
  periodCurrentStart: text('period_current_start').notNull(),
  periodCurrentEnd: text('period_current_end').notNull(),
  periodPreviousStart: text('period_previous_start').notNull(),
  periodPreviousEnd: text('period_previous_end').notNull(),
  excludedCount: integer('excluded_count').default(0).notNull(),
  feedback: text('feedback'), // 'misleading' | 'not_actionable' | 'valid' (false-positive review)
  status: text('status').default('open').notNull(), // 'open' | 'opened' | 'dismissed' | 'recovered'
  provisional: boolean('provisional').default(false).notNull(),
  entityLabel: text('entity_label').default('').notNull(),
  message: text('message').default('').notNull(),
  triggeredAt: text('triggered_at').default('').notNull(), // simulated-clock ISO timestamp
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const issues = pgTable('issues', {
  id: text('id').primaryKey(), // e.g. 'c0', 'p2', 'b10', 'd6', 'd27', 's26', 'i5'
  accountId: text('account_id').references(() => accounts.id).notNull(),
  campaignId: integer('campaign_id').references(() => campaigns.id).notNull(),
  detectedAt: text('detected_at').notNull(), // e.g. 'Today 6:10'
  detectedAtIso: text('detected_at_iso').notNull(),
  severity: text('severity').notNull(), // 'High' | 'Medium' | 'Info'
  metric: text('metric').notNull(), // 'CTR' | 'CPC' | 'Budget' | 'Data sync' | 'Setup'
  changeDisplay: text('change_display').notNull(), // e.g. '-25.7%'
  whyText: text('why_text').notNull(),
  state: text('state').default('open').notNull(), // 'open' | 'reviewed' | 'dismissed' | 'resolved'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const activityLog = pgTable('activity_log', {
  id: serial('id').primaryKey(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  userId: text('user_id').references(() => users.id),
  userName: text('user_name').default('Priya Nair').notNull(),
  timestampText: text('timestamp_text').notNull(), // e.g. 'Nov 15, 09:02'
  type: text('type').notNull(), // 'Campaign' | 'Group' | 'Alert' | 'Selection' | 'System'
  actionText: text('action_text').notNull(),
  relatedEntity: text('related_entity').default('—').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const analyticsEvents = pgTable('analytics_events', {
  id: serial('id').primaryKey(),
  event: text('event').notNull(),
  ts: text('ts').notNull(),
  accountId: text('account_id').notNull(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  source: text('source'),
  campaignId: integer('campaign_id'),
  adSetId: text('ad_set_id'),
  groupId: text('group_id'),
  alertId: text('alert_id'),
  issueId: text('issue_id'),
  objective: text('objective'),
  platform: text('platform'),
  severity: text('severity'),
  dataState: text('data_state'),
  selectedCount: integer('selected_count'),
  payload: text('payload'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const settings = pgTable('settings', {
  id: text('id').primaryKey(), // e.g. 'settings_acme-cooling-in'
  accountId: text('account_id').references(() => accounts.id).notNull(),
  dailySummaryEmail: boolean('daily_summary_email').default(true).notNull(),
  notifyImmediateHigh: boolean('notify_immediate_high').default(true).notNull(),
  defaultReportingPeriod: text('default_reporting_period').default('Last 7 days vs previous 7 days').notNull(),
  minImpressionsThreshold: integer('min_impressions_threshold').default(1000).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
