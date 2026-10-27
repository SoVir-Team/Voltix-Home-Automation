import { api } from './api';

/** Web push needs a service worker, the Push API and (on iOS) the app installed to the home screen. */
export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(): Promise<void> {
  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!publicKey) throw new Error('Push notifications are not configured on this server');
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error('Notifications are blocked for this site');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = sub.toJSON();
  await api.post('/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.del('/push/subscriptions', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
