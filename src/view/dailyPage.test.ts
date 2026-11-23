import { describe, expect, it, vi } from 'vitest';

// The day's page and the daily card (3.3.76, 3.3.77): the race, the board button under it, and the row
// on the results card that says what the board was told. The board button only exists where the platform
// has a board at all, so the platform is faked here.

const host = vi.hoisted(() => ({ board: 'in_game' as string }));
vi.mock('../platform', async (orig) => ({
  ...(await orig<typeof import('../platform')>()),
  boardType: () => host.board,
  canSignIn: () => false,
}));

const { dailyPage } = await import('./title');
const { dailyRaceHtml } = await import('./results');
const { parseSave } = await import('../meta');
const { dailyRaceOpen } = await import('../dailyRace');

/** A save that has ridden `races` races. */
const after = (races: number) => { const s = parseSave(null); s.races = races; return s; };

describe("the day's page", () => {
  it('carries the race and, where there is a board, the board under it', () => {
    host.board = 'in_game';
    const body = dailyPage(after(9)).body;
    expect(body).toContain('dracego');
    expect(body).toContain('dboardgo');
    expect(body.indexOf('dracego')).toBeLessThan(body.indexOf('dboardgo'));
  });

  it('drops the board button where the platform has no board', () => {
    host.board = 'not_available';
    const body = dailyPage(after(9)).body;
    expect(body).toContain('dracego');
    expect(body).not.toContain('dboardgo');
  });

  it('shows neither before the daily race opens', () => {
    host.board = 'in_game';
    const s = after(0);
    expect(dailyRaceOpen(s)).toBe(false);
    const body = dailyPage(s).body;
    expect(body).not.toContain('dracego');
    expect(body).not.toContain('dboardgo');
  });
});

describe('the daily results card', () => {
  const result = (pts: number, paid: number) => ({
    score: { place: 1, placePts: 900, kos: 0, koPts: 0, shoves: 0, shovePts: 0, near: 0, nearPts: 0, chain: 0, chainPts: 0, falls: 0, fallPts: 0, time: 30, timePts: -150, total: 750 },
    was: 0, best: true, runs: 1, paid, name: 'Rookie', mutator: null, pts,
  });

  it('always says where the board stands, with or without the day’s pay', () => {
    const save = after(9);
    expect(dailyRaceHtml(result(1234, 400), save)).toContain('1,234');
    const free = dailyRaceHtml(result(1234, 0), save);
    expect(free).toContain('1,234');
    expect(free).not.toContain('dRacePay');
  });
});
