'use client';

import { createClient } from '@/lib/supabase/client';
import type { DeviceInfo } from '@/types';

function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('fs_device_id');
  if (!id) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    id = [...arr]
      .map((b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem('fs_device_id', id);
  }
  return id;
}

function getDeviceType(): 'mobile' | 'pc' {
  if (typeof navigator === 'undefined') return 'pc';
  return /Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'pc';
}

function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent;
  let os = 'Unknown';
  let browser = 'Unknown';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac/i.test(ua)) os = 'macOS';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  return `${browser} / ${os}`;
}

export async function registerDevice(): Promise<{
  ok: boolean;
  error?: string;
  conflictDevice?: DeviceInfo;
  deviceType?: string;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: '사용자 정보 없음' };

  const deviceId = getDeviceId();
  const deviceType = getDeviceType();
  const deviceName = getDeviceName();
  const devices: DeviceInfo[] = user.user_metadata?.registered_devices || [];

  if (devices.find((d) => d.id === deviceId)) {
    const updated = devices.map((d) =>
      d.id === deviceId ? { ...d, last_seen: new Date().toISOString() } : d,
    );
    await supabase.auth.updateUser({ data: { registered_devices: updated } });
    return { ok: true };
  }

  const conflict = devices.find((d) => d.type === deviceType);
  if (conflict) {
    return { ok: false, conflictDevice: conflict, deviceType };
  }

  const newDevice: DeviceInfo = {
    id: deviceId,
    type: deviceType,
    name: deviceName,
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };
  await supabase.auth.updateUser({ data: { registered_devices: [...devices, newDevice] } });
  return { ok: true };
}

export async function replaceDevice(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const deviceId = getDeviceId();
  const deviceType = getDeviceType();
  const deviceName = getDeviceName();
  const devices = (user.user_metadata?.registered_devices || []).filter(
    (d: DeviceInfo) => d.type !== deviceType,
  );

  devices.push({
    id: deviceId,
    type: deviceType,
    name: deviceName,
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  });
  await supabase.auth.updateUser({ data: { registered_devices: devices } });
  return true;
}
