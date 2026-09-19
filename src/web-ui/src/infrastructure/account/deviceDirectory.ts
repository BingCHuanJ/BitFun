import { create } from 'zustand';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { remoteConnectAPI, deviceDisplayName, type AccountDeviceInfo } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { InvalidationSync } from '../../../../shared/relay-transport/InvalidationSync';

/** Presentation only: presence and saved peer/dispatch names never overwrite GET metadata. */
export const useDeviceDirectory = create<{ devices: AccountDeviceInfo[]; localId: string | null }>(() => ({ devices: [], localId: null }));
let invalidate: (() => Promise<void>) | undefined;
let generation = 0;

export function resolveDeviceName(deviceId: string, fallback = deviceId): string {
  const device = useDeviceDirectory.getState().devices.find(item => item.device_id === deviceId);
  return device ? deviceDisplayName(device) : fallback;
}

export function refreshDeviceDirectory(): Promise<void> {
  return invalidate?.() ?? Promise.resolve();
}

/** Mounted by the shell provider, fenced on account replacement and teardown. */
export function startDeviceDirectory(): () => void {
  const epoch = ++generation;
  useDeviceDirectory.setState({ devices: [], localId: null });
  const sync = new InvalidationSync(async () => {
    try {
      const [devices, local] = await Promise.all([remoteConnectAPI.accountListDevices(), remoteConnectAPI.getDeviceInfo()]);
      if (epoch === generation) useDeviceDirectory.setState({ devices, localId: local.device_id });
    } catch {
      // An unavailable directory is not evidence that a device or alias was removed.
    }
  });
  const refresh = () => sync.invalidate();
  invalidate = refresh;
  const stopPresence = api.listen('account://device-presence', () => { void refresh(); });
  const stopLogin = api.listen('account://login-state', () => { void refresh(); });
  const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
  document.addEventListener('visibilitychange', visible);
  const timer = setInterval(visible, 30_000);
  void refresh();
  return () => {
    sync.stop(); stopPresence(); stopLogin(); clearInterval(timer);
    document.removeEventListener('visibilitychange', visible);
    if (epoch === generation) {
      generation += 1;
      invalidate = undefined;
      useDeviceDirectory.setState({ devices: [], localId: null });
    }
  };
}
