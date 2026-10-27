import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import type { AppContext } from '../../context';
import {
  type HomeRole,
  homeMembers,
  notificationPrefs,
  notifications,
  pushSubscriptions,
  users,
} from '../../db/schema';
import type { Device } from '../devices/state.service';

export const notificationTypes = [
  'doorbell',
  'motion',
  'contact',
  'device_offline',
  'automation',
  'ota',
  'security',
] as const;
export type NotificationType = (typeof notificationTypes)[number];

const DEFAULTS: Record<NotificationType, { inApp: boolean; push: boolean; email: boolean }> = {
  doorbell: { inApp: true, push: true, email: false },
  motion: { inApp: true, push: false, email: false },
  contact: { inApp: true, push: true, email: false },
  device_offline: { inApp: true, push: true, email: false },
  automation: { inApp: true, push: true, email: false },
  ota: { inApp: true, push: false, email: false },
  security: { inApp: true, push: true, email: true },
};
export const defaultPrefs = DEFAULTS;

const OFFLINE_ALERT_DELAY_MS = 5 * 60_000;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  homeId?: string;
  /** Explicit recipients, or every member of homeId with at least minRole. */
  userIds?: string[];
  minRole?: HomeRole;
}

export class NotificationService {
  private readonly pushEnabled: boolean;
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly ctx: AppContext) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = ctx.env;
    this.pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
    if (this.pushEnabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }

  async notify(input: NotifyInput): Promise<void> {
    const recipients =
      input.userIds ?? (input.homeId ? await this.homeRecipients(input.homeId, input.minRole) : []);
    if (!recipients.length) return;
    const prefRows = await this.ctx.db
      .select()
      .from(notificationPrefs)
      .where(and(inArray(notificationPrefs.userId, recipients), eq(notificationPrefs.type, input.type)));
    const prefs = new Map(prefRows.map((p) => [p.userId, p]));

    for (const userId of recipients) {
      const pref = prefs.get(userId) ?? DEFAULTS[input.type];
      if (pref.inApp) {
        const [row] = await this.ctx.db
          .insert(notifications)
          .values({
            userId,
            homeId: input.homeId ?? null,
            type: input.type,
            title: input.title,
            body: input.body ?? '',
            data: input.data ?? {},
          })
          .returning();
        this.ctx.bus.publishUser(userId, { type: 'notification.new', notification: row! });
      }
      // Not awaited (slow network calls); catch so a database error can't become an unhandled rejection.
      if (pref.push) this.push(userId, input).catch((err) => this.ctx.log.warn({ err }, 'web push failed'));
      if (pref.email)
        this.email(userId, input).catch((err) => this.ctx.log.warn({ err }, 'notification email failed'));
    }
  }

  private async homeRecipients(homeId: string, minRole: HomeRole = 'member'): Promise<string[]> {
    const roles: HomeRole[] =
      minRole === 'owner'
        ? ['owner']
        : minRole === 'admin'
          ? ['owner', 'admin']
          : ['owner', 'admin', 'member'];
    const rows = await this.ctx.db
      .select({ userId: homeMembers.userId })
      .from(homeMembers)
      .where(and(eq(homeMembers.homeId, homeId), inArray(homeMembers.role, roles)));
    return rows.map((r) => r.userId);
  }

  private async push(userId: string, input: NotifyInput): Promise<void> {
    if (!this.pushEnabled) return;
    const subs = await this.ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    const body = JSON.stringify({
      title: input.title,
      body: input.body ?? '',
      data: { ...input.data, type: input.type },
    });
    await Promise.all(
      subs.map(async (s) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              body,
              {
                TTL: 3600,
                urgency: input.type === 'doorbell' || input.type === 'security' ? 'high' : 'normal',
              },
            );
            await this.ctx.db
              .update(pushSubscriptions)
              .set({ lastSuccessAt: new Date() })
              .where(eq(pushSubscriptions.id, s.id));
            return;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              await this.ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
              return;
            }
            if (attempt === 2) this.ctx.log.warn({ err, userId }, 'web push failed');
          }
        }
      }),
    );
  }

  private async email(userId: string, input: NotifyInput): Promise<void> {
    const [user] = await this.ctx.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!user) return;
    await this.ctx.mailer
      .send({
        to: user.email,
        subject: `Voltix: ${input.title}`,
        text: `${input.title}\n\n${input.body ?? ''}`,
      })
      .catch((err) => this.ctx.log.warn({ err }, 'notification email failed'));
  }

  /** Doorbell / motion / contact events. */
  async deviceAlert(device: Device, action: string, message: string): Promise<void> {
    const type: NotificationType =
      action === 'DoorbellPress' ? 'doorbell' : action === 'motion' ? 'motion' : 'contact';
    await this.notify({
      type,
      homeId: device.homeId,
      title: device.name,
      body: message,
      data: { deviceId: device.id, url: `/devices/${device.id}` },
    });
  }

  /** Alert owners/admins if a board stays offline for 5 minutes (avoids noise from quick reboots). */
  scheduleOfflineAlert(controllerId: string, homeId: string): void {
    clearTimeout(this.offlineTimers.get(controllerId));
    const t = setTimeout(() => {
      this.offlineTimers.delete(controllerId);
      if (this.ctx.services.gateway.isOnline(controllerId)) return;
      void this.notify({
        type: 'device_offline',
        homeId,
        minRole: 'admin',
        title: 'A Voltix board went offline',
        body: 'Its devices cannot be controlled until it reconnects. Check its power and Wi-Fi.',
        data: { controllerId, url: '/settings/boards' },
      }).catch((err) => this.ctx.log.error({ err }, 'offline alert failed'));
    }, OFFLINE_ALERT_DELAY_MS);
    t.unref();
    this.offlineTimers.set(controllerId, t);
  }

  close(): void {
    for (const t of this.offlineTimers.values()) clearTimeout(t);
  }
}
