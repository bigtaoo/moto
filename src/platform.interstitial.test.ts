import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The between-races ad's analytics (3.3.71): one ask, then whatever the Bridge says about it, or `quiet`
// when it says nothing. A fake Bridge stands in for Playgama's; vitest runs in node, so `window` is stubbed.

type Sent = { name: string; data: Record<string, unknown> };

async function boot(opts: { show?: () => void } = {}) {
  vi.resetModules();
  const sent: Sent[] = [];
  const handlers: ((s: string) => void)[] = [];
  const shown: string[] = [];
  const bridge = {
    initialize: () => Promise.resolve(),
    EVENT_NAME: { INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed' },
    platform: { id: 'playgama', on: () => {} },
    analytics: { send: (name: string, data: Record<string, unknown>) => sent.push({ name, data }) },
    advertisement: {
      interstitialState: 'closed',
      on: (_e: string, h: (s: string) => void) => { handlers.push(h); },
      showInterstitial: (p: string) => { shown.push(p); opts.show?.(); },
    },
  };
  vi.stubGlobal('window', { bridge });
  const p = await import('./platform');
  await p.initPlatform();
  p.flushEarly();
  const ads = () => sent.filter((e) => e.name === 'ad_interstitial').map((e) => e.data);
  return { p, ads, shown, say: (s: string) => handlers.forEach((h) => h(s)) };
}

describe('interstitial analytics', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.useRealTimers(); });

  it('says it asked, then each state the Bridge reports, with the seconds since the ask', async () => {
    const { p, ads, shown, say } = await boot();
    p.interstitial('race_end');
    expect(shown).toEqual(['race_end']);
    expect(p.interstitialOpen()).toBe(false);
    say('loading');
    expect(p.interstitialOpen()).toBe(true);
    vi.advanceTimersByTime(2000);
    say('opened');
    vi.advanceTimersByTime(4000);
    say('closed');
    expect(p.interstitialOpen()).toBe(false);
    expect(ads().map((d) => d.state)).toEqual(['asked', 'loading', 'opened', 'closed']);
    expect(ads().map((d) => d.placement)).toEqual(Array(4).fill('race_end'));
    expect(ads()[2].sec).toBe(2);
    expect(ads()[3].sec).toBe(6);
  });

  it('says quiet when the Bridge answers nothing, once, and not when it did answer', async () => {
    const { p, ads, say } = await boot();
    p.interstitial('race_end');
    vi.advanceTimersByTime(5000);
    expect(ads().map((d) => d.state)).toEqual(['asked', 'quiet']);
    p.interstitial('restart');
    say('loading');
    vi.advanceTimersByTime(5000);
    expect(ads().filter((d) => d.placement === 'restart').map((d) => d.state)).toEqual(['asked', 'loading']);
  });

  it('says error when asking throws', async () => {
    const { p, ads } = await boot({ show: () => { throw new Error('no'); } });
    p.interstitial('race_end');
    expect(ads().map((d) => d.state).slice(0, 2)).toEqual(['asked', 'error']);
  });

  it('stays silent where there is no Bridge', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    const p = await import('./platform');
    await p.initPlatform();
    expect(() => p.interstitial('race_end')).not.toThrow();
    expect(p.interstitialOpen()).toBe(false);
  });
});
