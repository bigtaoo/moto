// The early-session funnel, sent as Bridge analytics events (platform.track): how long the game took to
// load, when the first input came, whether the player was still playing at 30 s and 60 s, how the first
// race went step by step, and what they were doing when they left. Platform messages (game_ready,
// level_*) are counted by Bridge already and are not repeated here.

import { track } from './platform';

const t0 = performance.now();
const sec = () => Math.round((performance.now() - t0) / 1000);
let firstInput = false;
let played = 0;
const marks = [30, 60, 180, 600];
let racesThisSession = 0;
let screen = 'title';
let tutorial = false;
const steps = new Set<string>();

/** The first frame is up and the game can be played. */
export function loaded(): void {
  track('game_loaded', { ms: Math.round(performance.now() - t0) });
}

/** Any tap or key; only the first one of the session is sent. */
export function input(): void {
  if (firstInput) return;
  firstInput = true;
  track('first_input', { ms: Math.round(performance.now() - t0), screen });
}

/** The screen the player is on (for the leave reason). */
export function setScreen(s: string): void {
  screen = s;
}

/** Seconds of actual racing (not paused); sends play_30s, play_60s ... as they pass. */
export function playing(dt: number): void {
  played += dt;
  while (marks.length && played >= marks[0]) track(`play_${marks.shift()}s`, { races: racesThisSession });
}

/** A race is over. */
export function raceDone(place: number, career: number): void {
  racesThisSession++;
  if (tutorial) {
    tutorial = false;
    track('tutorial_completed', { place, sec: sec() });
  }
  if (career <= 5) track('early_race', { n: career, place });
}

/** The first race of a new player is the tutorial; its steps are the first steer and the first slap. */
export function startTutorial(): void {
  tutorial = true;
  track('tutorial_step', { step: 'start' });
}
export function tutorialStep(step: 'steer' | 'slap' | 'hit' | 'finish'): void {
  if (!tutorial || steps.has(step)) return;
  steps.add(step);
  track('tutorial_step', { step, sec: sec() });
}

/** Something worth counting in the career (upgrade bought, ride bought, sound switched ...). */
export function event(name: string, data?: Record<string, string | number | boolean>): void {
  track(name, data);
}

// leaving: the last screen, how long, how many races (pagehide is the one that fires on phones too)
let left = false;
addEventListener('pagehide', () => {
  if (left) return;
  left = true;
  track('session_end', { reason: screen, sec: sec(), races: racesThisSession, played: Math.round(played) });
});
