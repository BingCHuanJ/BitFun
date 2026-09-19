import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/services/accountDeviceSelection.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { isDeviceControllable, selectAccountDevice } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

const device = (id, extra = {}) => ({ device_id: id, device_name: id, online: true, ...extra });

test('only a confirmed incompatible flag is uncontrollable; a missing flag stays usable', () => {
  // Older Relays and older payloads omit the flag entirely.
  assert.equal(isDeviceControllable({}), true);
  assert.equal(isDeviceControllable({ compatible: undefined }), true);
  assert.equal(isDeviceControllable({ compatible: true }), true);
  assert.equal(isDeviceControllable({ compatible: false }), false);
});

test('an incompatible device stays listed but is never auto-selected', () => {
  const devices = [
    device('controller'),
    device('incompatible', { compatible: false, client_version: '0.9.0' }),
  ];
  // The device row remains available to the page for rendering.
  assert.equal(devices.some(item => item.device_id === 'incompatible'), true);
  assert.equal(
    selectAccountDevice(devices, 'controller'),
    null,
    'a confirmed-incompatible device is not a fallback target',
  );
});

test('automatic selection skips an incompatible peer and picks the next usable one', () => {
  const devices = [
    device('controller'),
    device('incompatible', { compatible: false }),
    device('usable'),
  ];
  assert.equal(selectAccountDevice(devices, 'controller')?.device_id, 'usable');
});

test('a preferred incompatible device never overrides the compatibility gate', () => {
  const devices = [device('controller'), device('incompatible', { compatible: false })];
  assert.equal(selectAccountDevice(devices, 'controller', 'incompatible'), null);
});

test('a preferred usable device is still honoured', () => {
  const devices = [device('controller'), device('first'), device('preferred')];
  assert.equal(selectAccountDevice(devices, 'controller', 'preferred')?.device_id, 'preferred');
});
