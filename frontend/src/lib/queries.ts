'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from './api';
import type {
  ActivityEvent,
  AppNotification,
  Automation,
  Controller,
  Device,
  DeviceState,
  EnergyReport,
  HistoryPoint,
  Home,
  Invite,
  Member,
  Room,
  Scene,
  Template,
  User,
} from './types';

/** Query keys in one place so realtime updates and mutations hit the same cache entries. */
export const qk = {
  me: ['me'] as const,
  homes: ['homes'] as const,
  home: (id: string) => ['home', id] as const,
  rooms: (homeId: string) => ['rooms', homeId] as const,
  devices: (homeId: string) => ['devices', homeId] as const,
  device: (id: string) => ['device', id] as const,
  controllers: (homeId: string) => ['controllers', homeId] as const,
  scenes: (homeId: string) => ['scenes', homeId] as const,
  automations: (homeId: string) => ['automations', homeId] as const,
  members: (homeId: string) => ['members', homeId] as const,
  energy: (homeId: string, range: string) => ['energy', homeId, range] as const,
  activity: (homeId: string, deviceId?: string) => ['activity', homeId, deviceId ?? 'all'] as const,
  history: (deviceId: string, metric: string, range: string) => ['history', deviceId, metric, range] as const,
  notifications: ['notifications'] as const,
  templates: ['templates'] as const,
  firmware: (homeId: string) => ['firmware', homeId] as const,
  /** Live OTA progress per board, written by the realtime client only. */
  ota: (controllerId: string) => ['ota', controllerId] as const,
};

export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<{ user: User }>('/me').then((r) => r.user),
    staleTime: 60_000,
  });

export const useHomes = () =>
  useQuery({ queryKey: qk.homes, queryFn: () => api.get<{ homes: Home[] }>('/homes').then((r) => r.homes) });

export const useRooms = (homeId?: string) =>
  useQuery({
    queryKey: qk.rooms(homeId ?? ''),
    queryFn: () => api.get<{ rooms: Room[] }>(`/homes/${homeId}/rooms`).then((r) => r.rooms),
    enabled: !!homeId,
  });

export const useDevices = (homeId?: string) =>
  useQuery({
    queryKey: qk.devices(homeId ?? ''),
    queryFn: () => api.get<{ devices: Device[] }>(`/homes/${homeId}/devices`).then((r) => r.devices),
    enabled: !!homeId,
  });

export const useDevice = (id: string) =>
  useQuery({
    queryKey: qk.device(id),
    queryFn: () => api.get<{ device: Device }>(`/devices/${id}`).then((r) => r.device),
  });

export const useControllers = (homeId?: string, enabled = true) =>
  useQuery({
    queryKey: qk.controllers(homeId ?? ''),
    queryFn: () =>
      api.get<{ controllers: Controller[] }>(`/homes/${homeId}/controllers`).then((r) => r.controllers),
    enabled: !!homeId && enabled,
  });

export const useScenes = (homeId?: string) =>
  useQuery({
    queryKey: qk.scenes(homeId ?? ''),
    queryFn: () => api.get<{ scenes: Scene[] }>(`/homes/${homeId}/scenes`).then((r) => r.scenes),
    enabled: !!homeId,
  });

export const useAutomations = (homeId?: string) =>
  useQuery({
    queryKey: qk.automations(homeId ?? ''),
    queryFn: () =>
      api.get<{ automations: Automation[] }>(`/homes/${homeId}/automations`).then((r) => r.automations),
    enabled: !!homeId,
  });

export const useMembers = (homeId?: string) =>
  useQuery({
    queryKey: qk.members(homeId ?? ''),
    queryFn: () => api.get<{ members: Member[]; invites: Invite[] }>(`/homes/${homeId}/members`),
    enabled: !!homeId,
  });

export const useEnergy = (homeId: string | undefined, range: 'week' | 'month' | 'year', enabled = true) =>
  useQuery({
    queryKey: qk.energy(homeId ?? '', range),
    queryFn: () => api.get<EnergyReport>(`/homes/${homeId}/energy?range=${range}`),
    enabled: !!homeId && enabled,
    staleTime: 60_000,
  });

export const useActivity = (homeId?: string, deviceId?: string) =>
  useQuery({
    queryKey: qk.activity(homeId ?? '', deviceId),
    queryFn: () =>
      api
        .get<{ events: ActivityEvent[]; nextBefore: number | null }>(
          `/homes/${homeId}/activity?limit=50${deviceId ? `&deviceId=${deviceId}` : ''}`,
        )
        .then((r) => r.events),
    enabled: !!homeId,
  });

export const useHistory = (deviceId: string, metric: string, range: string, enabled = true) =>
  useQuery({
    queryKey: qk.history(deviceId, metric, range),
    queryFn: () =>
      api
        .get<{ points: HistoryPoint[] }>(`/devices/${deviceId}/history?metric=${metric}&range=${range}`)
        .then((r) => r.points),
    enabled,
    staleTime: 60_000,
  });

export const useNotifications = () =>
  useQuery({
    queryKey: qk.notifications,
    queryFn: () =>
      api.get<{ notifications: AppNotification[]; unreadCount: number }>('/notifications?limit=50'),
    staleTime: 30_000,
  });

export interface BoardFirmware {
  controllerId: string;
  currentVersion: string | null;
  latest: { releaseId: string; version: string; notes: string | null } | null;
  updateAvailable: boolean;
}

export const useFirmware = (homeId: string) =>
  useQuery({
    queryKey: qk.firmware(homeId),
    queryFn: () => api.get<{ boards: BoardFirmware[] }>(`/homes/${homeId}/firmware`).then((r) => r.boards),
  });

export const useOtaProgress = (controllerId: string) =>
  useQuery<{ status: string; progress: number } | null>({
    queryKey: qk.ota(controllerId),
    queryFn: () => null,
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useTemplates = () =>
  useQuery({
    queryKey: qk.templates,
    queryFn: () => api.get<{ templates: Template[]; capabilities: string[] }>('/templates'),
    staleTime: 5 * 60_000,
  });

/**
 * Send a device action with an optimistic update: the UI flips instantly and rolls back (with a toast)
 * if the device is offline, rejects, or doesn't answer.
 */
export function useDeviceAction(device: Pick<Device, 'id' | 'homeId'>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: string; value: Record<string, unknown>; optimistic?: DeviceState }) =>
      api.post<{ state: DeviceState }>(`/devices/${device.id}/actions`, { action: v.action, value: v.value }),
    onMutate: async (v) => {
      if (!v.optimistic) return;
      const listKey = qk.devices(device.homeId);
      await qc.cancelQueries({ queryKey: listKey });
      const prevList = qc.getQueryData<Device[]>(listKey);
      const prevOne = qc.getQueryData<Device>(qk.device(device.id));
      const patch = (d: Device) =>
        d.id === device.id ? { ...d, state: { ...d.state, ...v.optimistic } } : d;
      qc.setQueryData<Device[]>(listKey, (l) => l?.map(patch));
      qc.setQueryData<Device>(qk.device(device.id), (d) => (d ? patch(d) : d));
      return { prevList, prevOne };
    },
    onError: (err, _v, snap) => {
      if (snap?.prevList) qc.setQueryData(qk.devices(device.homeId), snap.prevList);
      if (snap?.prevOne) qc.setQueryData(qk.device(device.id), snap.prevOne);
      toast.error(errorMessage(err));
    },
    onSuccess: (res) => {
      const patch = (d: Device) => (d.id === device.id ? { ...d, state: res.state } : d);
      qc.setQueryData<Device[]>(qk.devices(device.homeId), (l) => l?.map(patch));
      qc.setQueryData<Device>(qk.device(device.id), (d) => (d ? patch(d) : d));
    },
  });
}

/** Generic mutation that toasts errors and invalidates the given keys on success. */
export function useApiMutation<TVars, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: {
    invalidate?: readonly (readonly unknown[])[];
    success?: string;
    onSuccess?: (r: TRes, v: TVars) => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onError: (err) => toast.error(errorMessage(err)),
    onSuccess: (res, vars) => {
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(res, vars);
    },
  });
}
