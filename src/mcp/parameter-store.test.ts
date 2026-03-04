import { describe, it, expect, vi } from 'vitest';
import { ParameterStore, type SongParameters } from './parameter-store';

const validParams: SongParameters = {
  mood: 'chill',
  tempo: 90,
  style: 'jazz',
  duration: 60,
  mode: 'parameters',
  prompt: 'a mellow jazz track',
};

describe('ParameterStore', () => {
  it('starts with null', () => {
    const store = new ParameterStore();
    expect(store.get()).toBeNull();
  });

  it('stores and returns parameters', () => {
    const store = new ParameterStore();
    store.set(validParams);
    expect(store.get()).toEqual(validParams);
  });

  it('returns a copy (not the same reference)', () => {
    const store = new ParameterStore();
    store.set(validParams);
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('emits update event when parameters are set', () => {
    const store = new ParameterStore();
    const listener = vi.fn();
    store.on('update', listener);
    store.set(validParams);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(validParams);
  });

  it('overwrites previous parameters', () => {
    const store = new ParameterStore();
    store.set(validParams);
    const updated: SongParameters = { ...validParams, tempo: 120, mood: 'upbeat' };
    store.set(updated);
    expect(store.get()).toEqual(updated);
  });
});
