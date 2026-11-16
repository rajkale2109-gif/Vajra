import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { metricsService } from '../../services/metricsService.js';
import { config } from '../../config/index.js';

const overviewQuerySchema = z.object({
  current_start: z.string().default('2026-11-08'),
  current_end: z.string().default('2026-11-14'),
  previous_start: z.string().default('2026-11-01'),
  previous_end: z.string().default('2026-11-07'),
});

export const overviewRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    '/overview',
    {
      schema: {
        description: 'Get governance overview KPIs, like-for-like aggregations, open issues, and data quality warnings',
        tags: ['Overview'],
        querystring: {
          type: 'object',
          properties: {
            current_start: { type: 'string', default: '2026-11-08' },
            current_end: { type: 'string', default: '2026-11-14' },
            previous_start: { type: 'string', default: '2026-11-01' },
            previous_end: { type: 'string', default: '2026-11-07' },
          },
        },
      },
    },
    async (request, reply) => {
      const accountId = (request.headers['x-account-id'] as string) || config.DEFAULT_ACCOUNT_ID;
      const parsed = overviewQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid date parameters', details: parsed.error.format() });
      }

      const { current_start, current_end, previous_start, previous_end } = parsed.data;

      const data = await metricsService.getOverviewData(accountId, {
        currentStart: current_start,
        currentEnd: current_end,
        previousStart: previous_start,
        previousEnd: previous_end,
      });

      return reply.send(data);
    }
  );
};
