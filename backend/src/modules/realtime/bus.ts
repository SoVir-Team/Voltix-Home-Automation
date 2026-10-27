import { EventEmitter } from 'node:events';

/** Events pushed to browsers subscribed to a home (and to a user's private channel). */
export type RealtimeEvent =
  | { type: 'device.state'; deviceId: string; state: Record<string, unknown>; source: string; at: string }
  | { type: 'device.online'; controllerId: string; online: boolean; deviceIds: string[]; at: string }
  | { type: 'device.changed'; deviceId: string }
  | { type: 'notification.new'; notification: Record<string, unknown> }
  | { type: 'automation.run'; automationId: string; status: string; at: string }
  | { type: 'ota.progress'; controllerId: string; rolloutId: string; status: string; progress: number };

/**
 * In-process pub/sub. One backend process serves all homes at this scale; if a second instance is ever
 * needed, swap this for Postgres LISTEN/NOTIFY (same interface).
 */
export class Bus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publishHome(homeId: string, event: RealtimeEvent): void {
    this.emitter.emit(`home:${homeId}`, event);
  }

  publishUser(userId: string, event: RealtimeEvent): void {
    this.emitter.emit(`user:${userId}`, event);
  }

  subscribe(channel: `home:${string}` | `user:${string}`, fn: (e: RealtimeEvent) => void): () => void {
    this.emitter.on(channel, fn);
    return () => this.emitter.off(channel, fn);
  }
}
