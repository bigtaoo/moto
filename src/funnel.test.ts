import { describe, expect, it, vi } from 'vitest';

/** Every `track` call the funnel made, newest last. */
const sent = vi.hoisted(() => [] as { name: string; data: Record<string, unknown> }[]);
vi.mock('./platform', () => ({
  track: (name: string, data?: Record<string, unknown>) => { sent.push({ name, data: data ?? {} }); },
}));

/** A funnel with its session state untouched: it counts a session, so each test needs its own. */
async function session() {
  sent.length = 0;
  vi.resetModules();
  return await import('./funnel');
}

const names = () => sent.map((e) => e.name);
const first = (name: string) => sent.find((e) => e.name === name)?.data;

describe('the early-session funnel', () => {
  it('sends the load time with the boot stages it was given', async () => {
    const f = await session();
    f.loaded({ bridge: 120, save: 15 });
    expect(names()).toEqual(['game_loaded']);
    const d = first('game_loaded')!;
    expect(d.bridge).toBe(120);
    expect(typeof d.ms).toBe('number');
  });

  it('sends the first input once only, with the screen it happened on', async () => {
    const f = await session();
    f.setScreen('title');
    f.input();
    f.setScreen('race');
    f.input();
    f.input();
    expect(names()).toEqual(['first_input']);
    expect(first('first_input')!.screen).toBe('title');
    expect(f.currentScreen()).toBe('race');
  });

  it('passes each play mark once, in order, as the seconds of racing add up', async () => {
    const f = await session();
    f.playing(29);
    expect(names()).toEqual([]);
    f.playing(1);
    expect(names()).toEqual(['play_30s']);
    f.playing(29);
    expect(names()).toEqual(['play_30s']);
    f.playing(1);
    expect(names()).toEqual(['play_30s', 'play_60s']);
    // a long pause between frames passes several marks at once, still in order and still once each
    f.playing(600);
    expect(names()).toEqual(['play_30s', 'play_60s', 'play_180s', 'play_600s']);
    f.playing(600);
    expect(names().length).toBe(4);
  });

  it('counts the races it has seen on the play marks', async () => {
    const f = await session();
    f.raceDone(2);
    f.raceDone(1);
    sent.length = 0;
    f.playing(30);
    expect(first('play_30s')!.races).toBe(2);
  });

  it('runs the tutorial once, each step once, and finishes it on the first race', async () => {
    const f = await session();
    f.tutorialStep('steer'); // before the tutorial started: not a step
    expect(names()).toEqual([]);
    f.startTutorial();
    f.tutorialStep('steer');
    f.tutorialStep('steer');
    f.tutorialStep('slap');
    f.raceDone(4);
    expect(names()).toEqual(['tutorial_step', 'tutorial_step', 'tutorial_step', 'tutorial_completed']);
    expect(sent[1].data.step).toBe('steer');
    expect(sent[3].data.place).toBe(4);
    // the second race is not a tutorial any more
    sent.length = 0;
    f.tutorialStep('hit');
    f.raceDone(1);
    expect(names()).toEqual([]);
  });

  it('sends one session_end, with the screen, the races and whatever the game adds', async () => {
    const f = await session();
    f.setScreen('results');
    f.raceDone(3);
    f.playing(42);
    f.onLeave(() => ({ cash: 1200 }));
    sent.length = 0;
    f.leave();
    f.leave();
    expect(names()).toEqual(['session_end']);
    const d = first('session_end')!;
    expect(d.reason).toBe('results');
    expect(d.races).toBe(1);
    expect(d.played).toBe(42);
    expect(d.cash).toBe(1200);
  });
});
