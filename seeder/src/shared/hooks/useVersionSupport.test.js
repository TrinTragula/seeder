import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVersionSupport, ALL_STRUCTURE_TYPES, structureTypesIn, biomesIn } from './useVersionSupport';
import { clearSeedQueryCache } from './useSeedQuery';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { FakeQueueManager, defaultVersionSupport } from '../../test/fakes';
import { resetQueueManagerForTests } from '../engine';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));

const qm = () => FakeQueueManager.latest();
const ofKind = (kind) => qm().requests.filter((r) => r.kind === kind);
const MC = VERSIONS['26.3'];
const support = (mc = MC) => defaultVersionSupport(mc, [], ALL_STRUCTURE_TYPES);
const probe = (mc, options) => renderHook((props) => useVersionSupport(props.mc, props.options), { initialProps: { mc, options } });

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
});

describe('useVersionSupport', () => {
    it('asks GET_VERSION_SUPPORT for all 19 structure types, at high priority, and returns the reply', async () => {
        const { result } = probe(MC);
        expect(result.current).toEqual({ support: null, loading: true, error: null });
        const [request] = ofKind('GET_VERSION_SUPPORT');
        expect(ALL_STRUCTURE_TYPES).toEqual(STRUCTURES_OPTIONS.map((s) => s.value));
        expect(ALL_STRUCTURE_TYPES).toHaveLength(19);
        expect(request.data).toEqual({ mcVersion: MC, biomeIds: [], structTypes: ALL_STRUCTURE_TYPES });
        expect(request.opts.priority).toBe('high');
        await act(async () => { qm().resolveRequest('GET_VERSION_SUPPORT', support()); });
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.support).toMatchObject(support());
    });

    it('takes a legacy reply without an `error` field as a success', async () => {
        const { result } = probe(MC);
        await act(async () => { ofKind('GET_VERSION_SUPPORT')[0].resolve(support()); });
        expect(result.current.support.structures[5]).toBe(0);
        expect(result.current.error).toBeNull();
    });

    it('passes biome ids and a narrower type list through', () => {
        probe(MC, { biomeIds: [1, 185], structTypes: [5, 25] });
        expect(ofKind('GET_VERSION_SUPPORT')[0].data).toEqual({ mcVersion: MC, biomeIds: [1, 185], structTypes: [5, 25] });
    });

    it('two callers for the same version share one cached reply', async () => {
        probe(MC);
        await act(async () => { qm().resolveRequest('GET_VERSION_SUPPORT', support()); });
        const second = probe(MC);
        expect(second.result.current.loading).toBe(false);
        expect(second.result.current.support).toMatchObject(support());
        expect(ofKind('GET_VERSION_SUPPORT')).toHaveLength(1);
    });

    it('another version asks again', async () => {
        const { rerender } = probe(MC);
        await act(async () => { qm().resolveRequest('GET_VERSION_SUPPORT', support()); });
        rerender({ mc: VERSIONS['1.12'] });
        const requests = ofKind('GET_VERSION_SUPPORT');
        expect(requests).toHaveLength(2);
        expect(requests[1].data.mcVersion).toBe(VERSIONS['1.12']);
    });

    it('surfaces an error', async () => {
        const { result } = probe(MC);
        await act(async () => { qm().resolveRequest('GET_VERSION_SUPPORT', { error: { code: -1, message: 'unsupported version' } }); });
        expect(result.current).toEqual({ support: null, loading: false, error: { code: -1, message: 'unsupported version' } });
    });
});

describe('structureTypesIn / biomesIn', () => {
    const T = Object.fromEntries(STRUCTURES_OPTIONS.map((o) => [o.pureText, o.value]));
    const dims = (overrides) => ({ ...Object.fromEntries(ALL_STRUCTURE_TYPES.map((t) => [t, 0])), ...overrides });
    const SUPPORT = { structures: dims({ [T.Fortress]: -1, [T.Bastion]: -1, [T['End City']]: 1, [T['End Gateway']]: 1 }) };

    it('lists the types of each dimension in the offered order, Ruined Portal also in the Nether', () => {
        const overworld = structureTypesIn(SUPPORT, 0);
        expect(overworld).toContain(T.Village);
        expect(overworld).toContain(T['Ruined Portal']);
        expect(overworld).not.toContain(T.Fortress);
        expect(structureTypesIn(SUPPORT, -1)).toEqual([T['Ruined Portal'], T.Fortress, T.Bastion]);
        expect(structureTypesIn(SUPPORT, 1)).toEqual([T['End City'], T['End Gateway']]);
    });

    it('leaves out what the version lacks, Ruined Portal in the Nether included', () => {
        const old = { structures: dims({ [T.Fortress]: -1, [T['Ruined Portal']]: -100, [T.Village]: -100 }) };
        expect(structureTypesIn(old, 0)).not.toContain(T.Village);
        expect(structureTypesIn(old, -1)).toEqual([T.Fortress]);
    });

    it('biomesIn keeps the biomes that exist and generate in the dimension', () => {
        const support = { biomes: [1, 8, 9, 170], biomeDimensions: { 1: 0, 8: -1, 9: 1, 170: -1, 185: 0 } };
        expect(biomesIn(support, 0)).toEqual([1]);             // 185 is not on this version
        expect(biomesIn(support, -1)).toEqual([8, 170]);
        expect(biomesIn(support, 1)).toEqual([9]);
    });
});
