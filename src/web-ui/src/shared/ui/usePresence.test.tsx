// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from '@openbitfun/ui';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('overlay presence', () => {
  let root: Root;
  let host: HTMLDivElement;
  function Surface({ open }: { open: boolean }) {
    const { present, state } = usePresence(open, 100);
    return present ? <div data-state={state}>Surface</div> : null;
  }
  const render = (open: boolean) => act(() => root.render(<Surface open={open} />));
  beforeEach(() => {
    vi.useFakeTimers();
    const media = new EventTarget();
    Object.defineProperty(media, 'matches', { value: false });
    vi.stubGlobal('matchMedia', () => media);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('cancels entrance frames when dismissed and unmounts only after exit', () => {
    render(false);
    render(true);
    const surface = host.firstElementChild!;
    render(false);
    act(() => vi.advanceTimersByTime(99));
    expect(surface.getAttribute('data-state')).toBe('exiting');
    expect(surface.isConnected).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(surface.isConnected).toBe(false);
  });

  it('skips frame and exit delays when reduced motion is requested', () => {
    const media = new EventTarget();
    Object.defineProperty(media, 'matches', { value: true });
    vi.stubGlobal('matchMedia', () => media);
    render(false);
    render(true);
    expect(host.firstElementChild?.getAttribute('data-state')).toBe('entered');
    render(false);
    expect(host.childElementCount).toBe(0);
  });

  it('settles an in-progress exit when the motion preference changes', () => {
    const media = new EventTarget();
    let reduced = false;
    Object.defineProperty(media, 'matches', { get: () => reduced });
    vi.stubGlobal('matchMedia', () => media);
    render(true);
    act(() => vi.advanceTimersByTime(48));
    render(false);
    act(() => { reduced = true; media.dispatchEvent(new Event('change')); });
    expect(host.childElementCount).toBe(0);
  });
});
