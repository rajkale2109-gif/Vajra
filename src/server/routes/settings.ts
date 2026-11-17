import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/connection.js';
import * as schema from '../../db/schema.js';
import { HttpError, logActivity } from '../../services/workspaceService.js';
import { ctx } from './workspace.js';

export const REPORTING_PERIODS = ['Last 7 days vs previous 7 days', 'Last 30 days vs previous 30 days'] as const;

const settingsBody = z
  .object({
    dailySummaryEmail: z.boolean(),
    notifyImmediateHigh: z.boolean(),
    defaultReportingPeriod: z.enum(REPORTING_PERIODS),
    minImpressionsThreshold: z.number().int().min(0).max(1_000_000),
  })
  .partial();

async function loadSettings(accountId: string) {
  const { db } = await getDb();
  const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  if (!account) throw new HttpError(404, 'Account not found');
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.accountId, accountId));
  return { db, account, s };
}

export const settingsRoutes: FastifyPluginAsync = async (server) => {
  server.get('/settings', { schema: { tags: ['Settings'], description: 'Account profile, platform connections and preferences' } }, async (req) => {
    const c = ctx(req);
    const { db, account, s } = await loadSettings(c.accountId);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, c.userId));
    const connections = await db.select().from(schema.platformConnections).where(eq(schema.platformConnections.accountId, c.accountId));
    return {
      account: { id: account.id, name: account.name, currency: account.currency, timezone: account.timezone },
      user: user ? { name: user.name, email: user.email, role: user.role } : null,
      connections: connections.map((x) => ({
        platform: x.platform,
        status: x.status,
        lastSuccessfulSyncAt: x.lastSuccessfulSyncAt,
        message: x.syncMessage,
      })),
      preferences: {
        dailySummaryEmail: s?.dailySummaryEmail ?? true,
        notifyImmediateHigh: s?.notifyImmediateHigh ?? true,
        defaultReportingPeriod: s?.defaultReportingPeriod ?? REPORTING_PERIODS[0],
        minImpressionsThreshold: s?.minImpressionsThreshold ?? 1000,
      },
      reportingPeriodOptions: REPORTING_PERIODS,
    };
  });

  server.put('/settings', { schema: { tags: ['Settings'], description: 'Update account preferences' } }, async (req) => {
    const c = ctx(req);
    const patch = settingsBody.parse(req.body);
    if (!Object.keys(patch).length) throw new HttpError(400, 'No settings provided');
    const { db, s } = await loadSettings(c.accountId);
    if (s) {
      await db.update(schema.settings).set({ ...patch, updatedAt: new Date() }).where(eq(schema.settings.id, s.id));
    } else {
      await db.insert(schema.settings).values({ id: `settings_${c.accountId}`, accountId: c.accountId, ...patch });
    }
    await logActivity(c.accountId, 'System', `Settings updated: ${Object.keys(patch).join(', ')}`, 'Settings', c.userId);
    return { saved: true };
  });
};
