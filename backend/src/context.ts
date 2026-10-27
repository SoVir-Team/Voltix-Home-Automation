import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './config/env';
import type { Db, Sql } from './db/client';
import type { Mailer } from './lib/mailer';
import type { Bus } from './modules/realtime/bus';

/**
 * Process-wide dependencies passed to services. Services that depend on each other (gateway, automations,
 * notifications) are attached in app.ts once constructed.
 */
export interface AppContext {
  env: Env;
  db: Db;
  sql: Sql;
  log: FastifyBaseLogger;
  mailer: Mailer;
  bus: Bus;
  /** AES key for controller secrets at rest. */
  encKey: Buffer;
  services: Services;
}

/** Late-bound services (filled in app.ts). Typed loosely here to avoid import cycles. */
export interface Services {
  gateway: import('./modules/gateway/gateway').Gateway;
  automations: import('./modules/automations/engine').AutomationEngine;
  notifications: import('./modules/notifications/notifications.service').NotificationService;
}
