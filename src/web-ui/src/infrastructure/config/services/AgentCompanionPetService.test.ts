import { beforeEach, describe, expect, it, vi } from 'vitest';
import girlManifest from '../../../../public/agent-companion-pets/openbitfun-girl/pet.json';

const invoke = vi.fn();

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: { invoke },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
}));

vi.mock('@/infrastructure/runtime', () => ({
  isTauriRuntime: () => false,
}));

describe('AgentCompanionPetService built-in presets', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('defaults to the blue-golden cat while retaining the previous OpenBitFun preset', async () => {
    const { DEFAULT_AGENT_COMPANION_PET, listAgentCompanionPets } = await import('./AgentCompanionPetService');

    const pets = await listAgentCompanionPets();
    const blueGolden = pets.find(pet => pet.id === 'blue-golden');
    const openbitfun = pets.find(pet => pet.id === 'openbitfun');

    expect(DEFAULT_AGENT_COMPANION_PET).toMatchObject({
      id: 'blue-golden',
      displayName: '困困',
      source: 'preset',
      packagePath: '/agent-companion-pets/blue-golden',
      spritesheetPath: '/agent-companion-pets/blue-golden/spritesheet.png',
      spritesheetMimeType: 'image/png',
    });
    expect(blueGolden).toMatchObject({
      ...DEFAULT_AGENT_COMPANION_PET,
      previewSrc: '/agent-companion-pets/blue-golden/spritesheet.png',
    });
    expect(pets[0]).toMatchObject(DEFAULT_AGENT_COMPANION_PET);
    expect(openbitfun).toMatchObject({
      displayName: 'OpenBitFun',
      packagePath: '/agent-companion-pets/openbitfun',
      spritesheetPath: '/agent-companion-pets/openbitfun/spritesheet.webp',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('lists Fangling second and resolves its packaged v2 layout without host access', async () => {
    const { listAgentCompanionPets, resolveAgentCompanionPet } = await import('./AgentCompanionPetService');
    const pets = await listAgentCompanionPets();
    const girl = pets[1];

    expect(pets.slice(0, 3).map(pet => pet.id)).toEqual([
      'blue-golden', 'openbitfun-girl', 'deepseek-goldwhale',
    ]);
    expect(girl).toMatchObject({
      ...girlManifest,
      source: 'preset',
      spritesheetPath: `/agent-companion-pets/${girlManifest.id}/${girlManifest.spritesheetPath}`,
      spritesheetMimeType: 'image/webp',
    });
    const resolved = await resolveAgentCompanionPet(girl);
    expect(resolved.src).toBe(girl.spritesheetPath);
    expect(resolved.layout).toMatchObject({ version: 2, columns: 8, rows: 11, supportsLook: true });
    expect(invoke).not.toHaveBeenCalled();
  });
});


describe('reviewed external pet protocol', () => {
  beforeEach(() => invoke.mockReset());

  it('rejects hosts without reviewed import capability and unsafe previews', async () => {
    const { listExternalAgentCompanionPets } = await import('./AgentCompanionPetService');
    invoke.mockResolvedValueOnce({ pets: [] });
    await expect(listExternalAgentCompanionPets()).rejects.toThrow('unavailable');
    invoke.mockResolvedValueOnce({ importOperationsVersion: 1, external: {
      candidates: [{ sourceKey: 'cat', fingerprint: 'hash', pet: { packagePath: '/source/cat' }, previewDataUrl: 'file:///private/image' }], diagnostics: [],
    } });
    await expect(listExternalAgentCompanionPets()).rejects.toThrow('unavailable');
    expect(invoke).toHaveBeenCalledWith('list_agent_companion_pets', { request: { includeExternal: true } });
  });

  it('sends the reviewed fingerprint and emits changes only after a successful copy', async () => {
    const { importReviewedAgentCompanionPet, AGENT_COMPANION_PETS_CHANGED } = await import('./AgentCompanionPetService');
    const { globalEventBus } = await import('@/infrastructure/event-bus');
    const changed = vi.fn();
    const off = globalEventBus.on(AGENT_COMPANION_PETS_CHANGED, changed);
    const candidate = {
      sourceKey: 'cat', fingerprint: 'reviewed-hash', previewDataUrl: 'data:image/png;base64,AA==',
      pet: { id: 'cat', displayName: 'Cat', source: 'codex' as const, packagePath: '/source/cat', spritesheetPath: '/source/cat/sprite.png', spritesheetMimeType: 'image/png' },
      imported: null, copyModified: false, sourceChanged: false,
    };
    try {
      invoke.mockRejectedValueOnce(new Error('Source changed'));
      await expect(importReviewedAgentCompanionPet(candidate)).rejects.toThrow('Source changed');
      expect(changed).not.toHaveBeenCalled();
      invoke.mockResolvedValueOnce({ ...candidate.pet, source: 'user', packagePath: '/native/cat' });
      await expect(importReviewedAgentCompanionPet(candidate)).resolves.toMatchObject({ packagePath: '/native/cat' });
      expect(invoke).toHaveBeenLastCalledWith('import_agent_companion_pet_package', {
        request: { path: '/source/cat', expectedFingerprint: 'reviewed-hash' },
      });
      expect(changed).toHaveBeenCalledTimes(1);
    } finally { off(); }
  });
});
