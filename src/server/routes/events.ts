import { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/connection.js';
import * as schema from '../../db/schema.js';
import { ALL_EVENTS, CORE_EVENTS, computeSuccessMetrics, emit, eventInputSchema, recordEvent } from '../../services/eventsService.js';
import { HttpError, logActivity } from '../../services/workspaceService.js';
import { ctx } from './workspace.js';

async function loadIssue(accountId: string, id: string) {
  const { db } = await getDb();
  const [issue] = await db
    .select()
    .from(schema.issues)
    .where(and(eq(schema.issues.id, id), eq(schema.issues.accountId, accountId)));
  if (!issue) throw new HttpError(404, 'Issue not found');
  const [camp] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, issue.campaignId));
  return { db, issue, camp };
}

const sessionBody = z.object({ sessionId: z.string().min(1).max(64), source: z.string().max(64).optional() });

export const eventsRoutes: FastifyPluginAsync = async (server) => {
  server.get('/events/taxonomy', { schema: { tags: ['Analytics'], description: 'The tracking plan' } }, async () => ({
    core: CORE_EVENTS,
    all: ALL_EVENTS,
  }));

  // Client-side behaviour events. The server stamps timestamps and the account/user.
  server.post('/events', { schema: { tags: ['Analytics'], description: 'Record a product event' } }, async (req, reply) => {
    const body = eventInputSchema.parse(req.body);
    // Issue lifecycle events that carry measurement meaning are only emitted by the issue endpoints.
    if (body.event === 'issue_detected' || body.event === 'alert_triggered') {
      throw new HttpError(400, `${body.event} is emitted by the system, not by clients`);
    }
    await recordEvent(ctx(req), body);
    return reply.status(202).send({ accepted: true });
  });

  server.get('/metrics/success', { schema: { tags: ['Analytics'], description: 'Success metrics: North Star, drivers, guardrail and 60-day decision signals' } }, async (req) => {
    const q = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(7), export_baseline: z.coerce.number().positive().optional() })
      .parse(req.query);
    return computeSuccessMetrics(ctx(req).accountId, { days: q.days, exportBaselinePerWeek: q.export_baseline });
  });

  // ---- Issue lifecycle (each step is a measured event) ---------------------
  server.post('/issues/:id/open', { schema: { tags: ['Overview'], description: 'Planner opens the affected campaign for investigation' } }, async (req) => {
    const body = sessionBody.parse(req.body);
    const c = ctx(req);
    const { issue, camp } = await loadIssue(c.accountId, (req.params as any).id);
    await emit(c, {
      event: 'issue_opened',
      sessionId: body.sessionId,
      issueId: issue.id,
      campaignId: issue.campaignId,
      severity: issue.severity,
      platform: camp?.platform,
      objective: camp?.objective,
      source: body.source ?? 'triage',
    });
    return { ok: true, issueId: issue.id, campaignId: issue.campaignId };
  });

  server.post('/issues/:id/resolve', { schema: { tags: ['Overview'] } }, async (req) => {
    const body = sessionBody.parse(req.body);
    const c = ctx(req);
    const { db, issue, camp } = await loadIssue(c.accountId, (req.params as any).id);
    await db.update(schema.issues).set({ state: 'resolved', updatedAt: new Date() }).where(eq(schema.issues.id, issue.id));
    await emit(c, { event: 'issue_resolved', sessionId: body.sessionId, issueId: issue.id, campaignId: issue.campaignId, severity: issue.severity, platform: camp?.platform, source: body.source ?? 'triage' });
    await logActivity(c.accountId, 'Campaign', `Issue resolved (${issue.metric})`, camp?.displayName ?? String(issue.campaignId));
    return { ok: true };
  });

  server.post('/issues/:id/review', { schema: { tags: ['Overview'] } }, async (req) => {
    const c = ctx(req);
    const { db, issue, camp } = await loadIssue(c.accountId, (req.params as any).id);
    await db.update(schema.issues).set({ state: 'reviewed', updatedAt: new Date() }).where(eq(schema.issues.id, issue.id));
    await logActivity(c.accountId, 'Campaign', `Issue marked reviewed (${issue.metric})`, camp?.displayName ?? String(issue.campaignId));
    return { ok: true };
  });

  server.post('/issues/:id/dismiss', { schema: { tags: ['Overview'] } }, async (req) => {
    const body = sessionBody.parse(req.body);
    const c = ctx(req);
    const { db, issue, camp } = await loadIssue(c.accountId, (req.params as any).id);
    await db.update(schema.issues).set({ state: 'dismissed', updatedAt: new Date() }).where(eq(schema.issues.id, issue.id));
    await emit(c, { event: 'issue_dismissed', sessionId: body.sessionId, issueId: issue.id, campaignId: issue.campaignId, severity: issue.severity, source: body.source ?? 'triage' });
    await logActivity(c.accountId, 'Campaign', `Issue dismissed (${issue.metric})`, camp?.displayName ?? String(issue.campaignId));
    return { ok: true };
  });
};
