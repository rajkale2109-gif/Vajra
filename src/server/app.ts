import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { overviewRoutes } from './routes/overview.js';
import { campaignsRoutes } from './routes/campaigns.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // Enable CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // OpenAPI Documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Vajra Governance API',
        description: 'Real-time campaign governance and performance change detection for media planners',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3000/api',
          description: 'Local development server',
        },
      ],
      tags: [
        { name: 'Overview', description: 'Governance overview KPIs, like-for-like, and issues' },
        { name: 'Campaigns', description: 'Campaign performance and comparisons' },
        { name: 'Groups', description: 'Campaign business grouping and aggregated performance' },
        { name: 'Alerts', description: 'Rule evaluation and alerts engine' },
        { name: 'Activity', description: 'Audit trail and system events' },
        { name: 'Settings', description: 'Account settings and platform connections' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Register API routes
  await app.register(
    async (apiServer) => {
      await apiServer.register(overviewRoutes);
      await apiServer.register(campaignsRoutes);
    },
    { prefix: '/api' }
  );

  // Serve Frontend static assets when running standalone (Vercel CDN serves static assets directly)
  if (!process.env.VERCEL) {
    try {
      const { default: fastifyStatic } = await import('@fastify/static');
      let clientPath = path.resolve(process.cwd(), 'public');
      if (!fs.existsSync(clientPath)) {
        const fallbackClient = path.resolve(__dirname, '../client');
        const cwdClient = path.resolve(process.cwd(), 'src/client');
        clientPath = fs.existsSync(cwdClient) ? cwdClient : fallbackClient;
      }
      if (fs.existsSync(clientPath)) {
        await app.register(fastifyStatic, {
          root: clientPath,
          prefix: '/',
        });
      }
    } catch (e) {
      console.warn('Notice loading static file server:', e);
    }
  }

  return app;
}
