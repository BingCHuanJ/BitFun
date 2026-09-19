/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { startDeviceDirectory, refreshDeviceDirectory, resolveDeviceName, useDeviceDirectory } from './deviceDirectory';
const mocks = vi.hoisted(() => ({ list: vi.fn(), local: vi.fn(), events: new Map<string, () => void>() }));
vi.mock('@/infrastructure/api/service-api/RemoteConnectAPI', async original => ({
  ...await original<typeof import('@/infrastructure/api/service-api/RemoteConnectAPI')>(),
  remoteConnectAPI: { accountListDevices: mocks.list, getDeviceInfo: mocks.local },
}));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { listen: (name: string, listener: () => void) => { mocks.events.set(name, listener); return () => mocks.events.delete(name); } } }));
let stop = () => {};
afterEach(() => { stop(); vi.resetAllMocks(); });
const device = (alias: string | null) => ({ device_id: 'peer', device_name: 'technical', device_alias: alias, online: true, last_seen_at: null });
it('resolves active, local and persisted dispatch labels by ID; presence triggers GET, never overwrites metadata', async () => {
  mocks.local.mockResolvedValue({ device_id: 'peer' });
  mocks.list.mockResolvedValue([device('Alias')]);
  stop = startDeviceDirectory(); await refreshDeviceDirectory();
  expect(resolveDeviceName('peer', 'stale saved name')).toBe('Alias');
  expect(useDeviceDirectory.getState().localId).toBe('peer');
  mocks.list.mockResolvedValue([device('Renamed')]);
  mocks.events.get('account://device-presence')!(); await refreshDeviceDirectory();
  expect(resolveDeviceName('peer', 'technical')).toBe('Renamed');
  mocks.list.mockResolvedValue([device(null)]); await refreshDeviceDirectory();
  expect(resolveDeviceName('peer')).toBe('technical');
});
it('fences late old-account GET and preserves aliases on failed reads', async () => {
  mocks.local.mockResolvedValue({ device_id: 'peer' });
  let finish!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  stop = startDeviceDirectory(); await Promise.resolve(); stop();
  mocks.list.mockResolvedValue([device('New account')]);
  stop = startDeviceDirectory(); await refreshDeviceDirectory();
  finish([device('Old account')]); await Promise.resolve();
  expect(resolveDeviceName('peer')).toBe('New account');
  mocks.list.mockRejectedValue(new Error('offline')); await refreshDeviceDirectory();
  expect(resolveDeviceName('peer')).toBe('New account');
});
