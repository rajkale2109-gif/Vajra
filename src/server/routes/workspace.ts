import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import * as schema from '../../db/schema.js';
import { config } from '../../config/index.js';
import {
  createRule,
  deleteRule,
  dismissTrigger,
  evaluateAllRules,
  listAlerts,
  openTrigger,
  recommendMetrics,
  reviewTrigger,
  ruleInputSchema,
  setRuleStatus,
  testRule,
} from '../../services/alertsService.js';
import { emit } from '../../services/eventsService.js';
import {
  addToGroup,
  bulkStatus,
  createGroup,
  deleteGroup,
  getCampaignDetail,
  HttpError,
  listActivity,
  listGroups,
  removeFromGroup,
} from '../../services/workspaceService.js';

const dateQuery = z.object({
  current_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-11-08'),
  current_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-11-14'),
  previous_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-11-01'),
  previous_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-11-07'),
});

export const ctx = (req: FastifyRequest) => ({
  accountId: (req.headers['x-account-id'] as string) || config.DEFAULT_ACCOUNT_ID,
  userId: (req.headers['x-user-id'] as string) || config.DEFAULT_USER_ID,
});

const sessionOf = (req: FastifyRequest) => String(req.headers['x-session-id'] || 'api');

const toDates = (q: unknown) => {
  const p = dateQuery.parse(q);
  return { currentStart: p.current_start, currentEnd: p.current_end, previousStart: p.previous_start, previousEnd: p.previous_end };
};

/** Maps validation / domain errors onto clean HTTP responses. */
export function installErrorHandler(server: FastifyInstance) {
  server.setErrorHandler((err: any, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Invalid request', details: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) });
    }
    if (err.validation) return reply.status(400).send({ error: err.message });
    server.log.error(err);
    return reply.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : 'Internal Server Error' });
  });
}

const groupBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200).default(''),
  campaignIds: z.array(z.number().int()).default([]),
});

const bulkBody = z.object({
  action: z.enum(['pause', 'resume']),
  campaignIds: z.array(z.number().int()).default([]),
  adSetIds: z.array(z.string()).default([]),
  confirm: z.boolean().default(false),
  totalCampaigns: z.number().int().optional(),
});

export const workspaceRoutes: FastifyPluginAsync = async (server) => {
  // ---- Drilldown -----------------------------------------------------------
  server.get('/campaigns/:id', { schema: { description: 'Campaign drilldown to ad-set level', tags: ['Campaigns'] } }, async (req) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid campaign id');
    return getCampaignDetail(ctx(req).accountId, id, toDates(req.query));
  });

  server.get('/adsets', { schema: { description: 'Ad sets (for alert targeting)', tags: ['Campaigns'] } }, async (req) => {
    const { db } = await getDb();
    const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.accountId, ctx(req).accountId));
    const names = new Map(camps.map((c) => [c.id, c.displayName]));
    const rows = camps.length ? await db.select().from(schema.adSets).where(inArray(schema.adSets.campaignId, camps.map((c) => c.id))) : [];
    return { items: rows.map((a) => ({ id: a.id, name: a.name, status: a.status, campaignId: a.campaignId, campaignName: names.get(a.campaignId) ?? '' })) };
  });

  // ---- Bulk actions --------------------------------------------------------
  server.post('/bulk/status', { schema: { description: 'Pause/resume selected campaigns or ad sets. Requires confirm=true.', tags: ['Campaigns'] } }, async (req, reply) => {
    const body = bulkBody.parse(req.body);
    const c = ctx(req);
    const result = await bulkStatus(c.accountId, body);
    await emit(c, { event: 'bulk_action_confirmed', sessionId: sessionOf(req), selectedCount: result.applied.length, source: 'campaign_table', payload: { action: body.action, scope: result.scope.summary } });
    return reply.send(result);
  });

  // ---- Groups --------------------------------------------------------------
  server.get('/groups', { schema: { description: 'Groups with like-for-like combined performance', tags: ['Groups'] } }, async (req) => ({
    groups: await listGroups(ctx(req).accountId, toDates(req.query)),
  }));

  server.post('/groups', { schema: { tags: ['Groups'], description: 'Create a group (optionally with campaigns)' } }, async (req, reply) => {
    const body = groupBody.parse(req.body);
    const c = ctx(req);
    const created = await createGroup(c.accountId, body.name, body.description, body.campaignIds);
    await emit(c, { event: 'group_created', sessionId: sessionOf(req), groupId: created.id, selectedCount: created.added.length, source: 'groups_page' });
    return reply.status(201).send(created);
  });

  server.post('/groups/:id/campaigns', { schema: { tags: ['Groups'], description: 'Add campaigns to a group; duplicates are blocked' } }, async (req, reply) => {
    const body = z.object({ campaignIds: z.array(z.number().int()).min(1) }).parse(req.body);
    const c = ctx(req);
    const groupId = (req.params as any).id as string;
    const result = await addToGroup(c.accountId, groupId, body.campaignIds);
    if (result.added.length) {
      await emit(c, { event: 'group_campaign_added', sessionId: sessionOf(req), groupId, selectedCount: result.added.length, source: 'groups_page' });
    }
    if (result.skipped.some((s) => s.reason === 'duplicate')) {
      await emit(c, { event: 'group_add_blocked_duplicate', sessionId: sessionOf(req), groupId, source: 'groups_page' });
    }
    // Everything blocked as duplicate → 409 so the UI can say so plainly
    if (!result.added.length && result.skipped.length && result.skipped.every((s) => s.reason === 'duplicate')) {
      return reply.status(409).send({ error: 'Campaign is already in this group (a campaign can appear only once).', ...result });
    }
    return reply.send(result);
  });

  server.delete('/groups/:id/campaigns/:campaignId', { schema: { tags: ['Groups'] } }, async (req, reply) => {
    const p = req.params as any;
    await removeFromGroup(ctx(req).accountId, p.id, Number(p.campaignId));
    return reply.status(204).send();
  });

  server.delete('/groups/:id', { schema: { tags: ['Groups'] } }, async (req, reply) => {
    await deleteGroup(ctx(req).accountId, (req.params as any).id);
    return reply.status(204).send();
  });

  // ---- Alerts --------------------------------------------------------------
  server.get('/alerts', { schema: { tags: ['Alerts'], description: 'Alert rules and triggered alerts' } }, async (req) => listAlerts(ctx(req).accountId));

  server.get('/alerts/recommendations', { schema: { tags: ['Alerts'], description: 'Objective-aware default metrics (recommend, never restrict)' } }, async (req) => {
    const q = z
      .object({ entityType: z.enum(['campaigns', 'group', 'adsets']), entityIds: z.string().min(1) })
      .parse(req.query);
    return recommendMetrics(ctx(req).accountId, q.entityType, q.entityIds.split(','));
  });

  server.post('/alerts', { schema: { tags: ['Alerts'], description: 'Create an alert rule' } }, async (req, reply) => {
    const body = ruleInputSchema.parse(req.body);
    const c = ctx(req);
    const created = await createRule(c.accountId, body);
    await emit(c, {
      event: 'alert_created',
      sessionId: sessionOf(req),
      alertId: created.id,
      groupId: body.entityType === 'group' ? String(body.entityIds[0]) : undefined,
      source: 'alerts_page',
      payload: { metric: body.metric, condition: body.condition, entityType: body.entityType },
    });
    return reply.status(201).send(created);
  });

  server.post('/alerts/test', { schema: { tags: ['Alerts'], description: 'Dry-run a rule against current data' } }, async (req) => {
    const body = ruleInputSchema.parse(req.body);
    const c = ctx(req);
    const result = await testRule(c.accountId, body);
    await emit(c, { event: 'alert_tested', sessionId: sessionOf(req), source: 'alerts_page', selectedCount: result.wouldTrigger.length });
    return result;
  });

  server.post('/alerts/evaluate', { schema: { tags: ['Alerts'], description: 'Run the alert engine (deduplicated, with cooldown)' } }, async (req) => {
    const c = ctx(req);
    return evaluateAllRules(c.accountId, c.userId);
  });

  server.post('/alerts/:id/status', { schema: { tags: ['Alerts'] } }, async (req, reply) => {
    const body = z.object({ status: z.enum(['Active', 'Paused']) }).parse(req.body);
    await setRuleStatus(ctx(req).accountId, (req.params as any).id, body.status);
    return reply.send({ ok: true });
  });

  server.delete('/alerts/:id', { schema: { tags: ['Alerts'] } }, async (req, reply) => {
    await deleteRule(ctx(req).accountId, (req.params as any).id);
    return reply.status(204).send();
  });

  const triggerId = (req: FastifyRequest) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid trigger id');
    return id;
  };
  server.post('/alerts/triggers/:id/open', { schema: { tags: ['Alerts'] } }, async (req) => {
    const c = ctx(req);
    return openTrigger(c.accountId, c.userId, triggerId(req), sessionOf(req));
  });
  server.post('/alerts/triggers/:id/dismiss', { schema: { tags: ['Alerts'] } }, async (req) => {
    const c = ctx(req);
    return dismissTrigger(c.accountId, c.userId, triggerId(req), sessionOf(req));
  });
  server.post('/alerts/triggers/:id/feedback', { schema: { tags: ['Alerts'], description: 'Planner verdict used for the false-positive guardrail' } }, async (req) => {
    const body = z.object({ verdict: z.enum(['valid', 'misleading', 'not_actionable']) }).parse(req.body);
    const c = ctx(req);
    return reviewTrigger(c.accountId, c.userId, triggerId(req), body.verdict, sessionOf(req));
  });

  // ---- Activity ------------------------------------------------------------
  server.get('/activity', { schema: { tags: ['Activity'] } }, async (req) => {
    const q = z.object({ type: z.string().optional() }).parse(req.query);
    return { items: await listActivity(ctx(req).accountId, q.type) };
  });
};
