'use client';

import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { refreshSession } from './api';
import { qk } from './queries';
import type { Controller, Device, RealtimeEvent } from './types';

function socketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/v1/ws`;
}

/**
 * One socket per tab. Keeps the TanStack Query cache in sync with live device state, so every screen
 * updates when someone flips a wall switch. Reconnects with jittered backoff and resubscribes.
 */
export class Realtime {
  private ws?: WebSocket;
  private homeId?: string;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  private stopped = false;
  private opened = false;
  onStatus?: (connected: boolean) => void;

  constructor(private readonly qc: QueryClient) {}

  start(homeId: string) {
    this.homeId = homeId;
    this.stopped = false;
    if (this.ws?.readyState === WebSocket.OPEN) this.subscribe();
    else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.ping);
    this.ws?.close(1000);
    this.ws = undefined;
  }

  private connect() {
    this.opened = false;
    const ws = new WebSocket(socketUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.opened = true;
      this.attempt = 0;
      this.onStatus?.(true);
      this.subscribe();
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
    };
    ws.onmessage = (e) => {
      try {
        this.handle(JSON.parse(String(e.data)) as RealtimeEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      // A socket replaced by stop()/start() (remount, home switch) must not reconnect: that would open a duplicate.
      if (this.ws !== ws) return;
      clearInterval(this.ping);
      this.onStatus?.(false);
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private async scheduleReconnect() {
    // Never opened: most likely the access token expired. Refresh before trying again.
    if (!this.opened) await refreshSession();
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) * (0.6 + Math.random() * 0.8);
    this.timer = setTimeout(() => this.connect(), delay);
    // Data may have changed while we were away.
    if (this.homeId) void this.qc.invalidateQueries({ queryKey: qk.devices(this.homeId) });
  }

  private subscribe() {
    if (this.homeId && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', homeId: this.homeId }));
    }
  }

  private handle(msg: RealtimeEvent) {
    const homeId = this.homeId;
    if (!homeId) return;
    switch (msg.type) {
      case 'device.state': {
        const patch = (d: Device) =>
          d.id === msg.deviceId ? { ...d, state: msg.state, stateUpdatedAt: new Date().toISOString() } : d;
        this.qc.setQueryData<Device[]>(qk.devices(homeId), (list) => list?.map(patch));
        this.qc.setQueryData<Device>(qk.device(msg.deviceId), (d) => (d ? patch(d) : d));
        break;
      }
      case 'device.online': {
        const patch = (d: Device) => (d.controllerId === msg.controllerId ? { ...d, online: msg.online } : d);
        this.qc.setQueryData<Device[]>(qk.devices(homeId), (list) => list?.map(patch));
        this.qc.setQueryData<Controller[]>(qk.controllers(homeId), (list) =>
          list?.map((c) => (c.id === msg.controllerId ? { ...c, online: msg.online } : c)),
        );
        void this.qc.invalidateQueries({ queryKey: ['device'] });
        break;
      }
      case 'device.changed':
        void this.qc.invalidateQueries({ queryKey: qk.devices(homeId) });
        void this.qc.invalidateQueries({ queryKey: qk.device(msg.deviceId) });
        void this.qc.invalidateQueries({ queryKey: qk.rooms(homeId) });
        break;
      case 'notification.new':
        void this.qc.invalidateQueries({ queryKey: qk.notifications });
        toast(msg.notification.title, { description: msg.notification.body || undefined });
        break;
      case 'automation.run':
        void this.qc.invalidateQueries({ queryKey: ['automation-runs', msg.automationId] });
        break;
      case 'ota.progress':
        this.qc.setQueryData(qk.ota(msg.controllerId), { status: msg.status, progress: msg.progress });
        void this.qc.invalidateQueries({ queryKey: qk.controllers(homeId) });
        void this.qc.invalidateQueries({ queryKey: qk.firmware(homeId) });
        break;
    }
  }
}
