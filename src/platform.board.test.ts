import { beforeEach, describe, expect, it, vi } from 'vitest';

// The leaderboard's own analytics (3.3.63): whether a write landed, whether a read came back and held the
// player's row. A fake Bridge stands in for Playgama's; vitest runs in node, so `window` is stubbed per test.

type Sent = { name: string; data: Record<string, unknown> };

async function boot(board: { setScore: (id: string, s: number) => Promise<unknown>; getEntries?: (id: string) => Promise<unknown> }) {
  vi.resetModules();
  const sent: Sent[] = [];
  const bridge = {
    initialize: () => Promise.resolve(),
    EVENT_NAME: {},
    platform: { id: 'playgama', on: () => {} },
    player: { id: 'p1' },
    analytics: { send: (name: string, data: Record<string, unknown>) => sent.push({ name, data }) },
    leaderboards: { type: 'in_game', getEntries: () => Promise.resolve([]), ...board },
  };
  vi.stubGlobal('window', { bridge });
  const p = await import('./platform');
  await p.initPlatform();
  p.flushEarly();
  return { p, sent, board: sent.filter((e) => e.name.startsWith('board_')) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('leaderboard analytics', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('says a write landed', async () => {
    const { p, sent } = await boot({ setScore: () => Promise.resolve() });
    p.submitScore(12);
    await settle();
    const w = sent.filter((e) => e.name === 'board_write');
    expect(w).toHaveLength(1);
    expect(w[0].data).toMatchObject({ ok: true, score: 12 });
  });

  it('says a write failed, and tries that score again after the next race', async () => {
    const calls: number[] = [];
    const { p, sent } = await boot({ setScore: (_id, s) => { calls.push(s); return Promise.reject(new Error('nope')); } });
    p.submitScore(12);
    await settle();
    p.submitScore(12);
    await settle();
    expect(calls).toEqual([12, 12]);
    expect(sent.filter((e) => e.name === 'board_write').map((e) => e.data)).toEqual([
      expect.objectContaining({ ok: false, score: 12, err: 'error' }),
      expect.objectContaining({ ok: false, score: 12, err: 'error' }),
    ]);
  });

  it('says a read came back, how long it was and whether the player was on it', async () => {
    const { p, sent } = await boot({
      setScore: () => Promise.resolve(),
      getEntries: () => Promise.resolve([{ id: 'p0', name: 'A', score: 40, rank: 1 }, { id: 'p1', name: 'Me', score: 12, rank: 2 }]),
    });
    const list = await p.boardEntries();
    expect(list.map((e) => e.me)).toEqual([false, true]);
    expect(sent.find((e) => e.name === 'board_read')!.data).toMatchObject({ ok: true, n: 2, mine: true });
  });

  it('says a read failed, and still rejects for the board card', async () => {
    const { p, sent } = await boot({ setScore: () => Promise.resolve(), getEntries: () => Promise.reject(new Error('down')) });
    await expect(p.boardEntries()).rejects.toThrow('down');
    expect(sent.find((e) => e.name === 'board_read')!.data).toMatchObject({ ok: false, err: 'error' });
  });
});
