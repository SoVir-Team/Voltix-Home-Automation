import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { MAX_DEVICE_MESSAGE_BYTES } from '@voltix/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env';
import type { AppContext, Services } from './context';
import { createDb } from './db/client';
import { AppError } from './lib/errors';
import { createMailer, type Mailer } from './lib/mailer';
import { adminRoutes } from './modules/admin/admin.routes';
import { apiKeysRoutes } from './modules/api-keys/api-keys.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { automationsRoutes } from './modules/automations/automations.routes';
import { AutomationEngine } from './modules/automations/engine';
import { controllersRoutes } from './modules/controllers/controllers.routes';
import { devicesRoutes } from './modules/devices/devices.routes';
import { onControllerConnected, onControllerOffline, onDeviceEvent } from './modules/devices/devices.service';
import { energyRoutes } from './modules/energy/energy.routes';
import { Gateway } from './modules/gateway/gateway';
import { wsRoutes } from './modules/gateway/ws.routes';
import { homesRoutes } from './modules/homes/homes.routes';
import { Maintenance } from './modules/maintenance/maintenance';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { NotificationService } from './modules/notifications/notifications.service';
import { otaRoutes, registerOtaHandlers } from './modules/ota/ota.routes';
import { Bus } from './modules/realtime/bus';
import { scenesRoutes } from './modules/scenes/scenes.routes';
import { telemetryRoutes } from './modules/telemetry/telemetry.routes';
import { templatesRoutes } from './modules/templates/templates.routes';
import { authPlugin } from './plugins/auth';

export interface BuildOptions {
  env: Env;
  /** Override the mailer (tests). */
  mailer?: Mailer;
  /** Start background jobs (scheduler, maintenance). Off in most tests. */
  background?: boolean;
  /** Override the device offline grace period (tests). */
  offlineGraceMs?: number;
}

export async function buildApp({
  env,
  mailer,
  background = true,
  offlineGraceMs,
}: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-voltix-sig"]',
        '*.password',
        '*.secret',
      ],
      ...(env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { singleLine: true } },
      }),
    },
    // Only the TLS reverse proxy may set the client IP; anyone else could spoof it past rate limits.
    trustProxy: env.TRUST_PROXY.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    bodyLimit: 100 * 1024,
    // Signed OTA download tokens are ~130 chars (default limit 100 answers 414).
    routerOptions: { maxParamLength: 300 },
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const { db, sql } = createDb(env.DATABASE_URL);
  const ctx: AppContext = {
    env,
    db,
    sql,
    log: app.log,
    mailer: mailer ?? createMailer(env),
    bus: new Bus(),
    encKey: Buffer.from(env.SECRET_ENC_KEY, 'base64'),
    services: {} as Services,
  };
  const gateway = new Gateway(ctx, offlineGraceMs);
  gateway.hooks = {
    onConnected: (auth, meta) => onControllerConnected(ctx, auth, meta),
    onOffline: (auth) => onControllerOffline(ctx, auth),
    onEvent: (auth, payload) => onDeviceEvent(ctx, auth, payload),
  };
  ctx.services.gateway = gateway;
  ctx.services.notifications = new NotificationService(ctx);
  ctx.services.automations = new AutomationEngine(ctx);
  registerOtaHandlers();
  const maintenance = new Maintenance(ctx);

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply
        .code(429)
        .send({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } });
    }
    if (status < 500) {
      return reply.code(status).send({
        error: { code: (err as { code?: string }).code ?? 'BAD_REQUEST', message: (err as Error).message },
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } });
  });

  await app.register(helmet, { contentSecurityPolicy: false }); // API serves JSON; the web app sets its own CSP
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
  });
  await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
  await app.register(websocket, { options: { maxPayload: MAX_DEVICE_MESSAGE_BYTES } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Voltix API', version: '1.0.0', description: 'Voltix home automation REST API' },
      components: {
        securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'vx_... API key' } },
      },
      security: [{ apiKey: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.get('/api/health', { config: { public: true } }, async () => {
    await sql`SELECT 1`;
    return { ok: true, devicesConnected: gateway.connectionCount };
  });

  await app.register(
    async (api) => {
      await api.register(authPlugin, { ctx });
      for (const routes of [
        authRoutes,
        homesRoutes,
        controllersRoutes,
        devicesRoutes,
        scenesRoutes,
        automationsRoutes,
        notificationsRoutes,
        energyRoutes,
        telemetryRoutes,
        apiKeysRoutes,
        templatesRoutes,
        otaRoutes,
        adminRoutes,
      ]) {
        await api.register(routes, { ctx });
      }
      await api.register(wsRoutes, { ctx });
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onReady', async () => {
    if (!background) return;
    await sql`UPDATE controllers SET online = false WHERE online`; // nobody is connected to a fresh process
    await ctx.services.automations.start();
    maintenance.start();
  });
  app.addHook('onClose', async () => {
    maintenance.stop();
    ctx.services.automations.stop();
    ctx.services.notifications.close();
    gateway.close();
    await sql.end({ timeout: 5 });
  });

  return { app, ctx };
}
