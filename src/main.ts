// Wires the 30 Hz sim to the 3D view, the HUD, input, sound and the save.

import './style.css';
import { World, type SimEvent } from './sim/world';
import * as C from './sim/config';
import { botInput } from './sim/ai';
import { Recorder } from './sim/replay';
import { Stage, RaceView } from './view/scene';
import { Controls } from './view/input';
import { Hud, type RaceResult } from './view/hud';
import { sfx, unlockAudio, suspendAudio, setMuted } from './view/audio';
import { parseSave, storeSave, type Save } from './meta';
import { CUP_RACES, riderName, settleRace, buyUpgrade, chooseRide, REVENGE_PAY, type UpKey } from './career';
import * as platform from './platform';

const params = new URLSearchParams(location.search);
const BOT = params.has('bot');
const LEN = Number(params.get('len')) || undefined;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const app = document.getElementById('app')!;
const titleEl = document.getElementById('title')!;
const stage = new Stage(canvas);
const hud = new Hud(app);
let save!: Save;

let world!: World;
let view!: RaceView;
let recorder!: Recorder;
let state: 'title' | 'race' | 'results' = 'title';
let paused = false;
/** The host (or an ad) has the game paused; separate from the player's own pause menu. */
let hostPaused = false;
let hostMuted = false;
/** The rewarded "back on now" was used this race. */
let remountUsed = false;
/** Seconds the player has been down (the remount button waits for the tumble to end). */
let downClock = 0;
let acc = 0;
let hitstop = 0;
let slow = 0;
let atkBuffer = 0;
let lastCount = -1;
let lastGrudgeKos = 0;
const rnd = Math.random;

const controls = new Controls(canvas, () => (world ? world.player.x : 0), () => {
  if (!world) return [-C.EDGE, C.EDGE];
  const p = world.player;
  const R = world.road;
  let [lo, hi] = R.bounds(p.x, p.z);
  hi = Math.max(hi, C.EDGE); // the cones don't hold the player in
  // a trail's opening coming up: pushing out holds the player on the barrier and lets them in when it opens
  const i = R.nextCut(p.z);
  const c = i >= 0 ? R.cuts[i] : null;
  if (c && c.z0 - p.z < 50 && p.z < c.z0 + C.CUT.gap) {
    if (c.side > 0) hi = C.CUT.outer;
    else lo = -C.CUT.outer;
  }
  return [lo, hi];
});

function newRace(): void {
  view?.dispose();
  const seed = ((save.races * 7919 + 17) % 99991) + 1;
  const nem = save.feud.nemesis;
  const opts = { seed, upgrades: save.up, grudges: save.grudges, length: LEN, div: save.div, tier: save.tier, vehicle: save.garage.cur, nemesis: nem?.id };
  world = new World(opts);
  recorder = new Recorder(opts);
  view = new RaceView(stage, world, seed);
  hud.setup(world);
  hud.hideResults();
  intro();
  hud.showRemount(false);
  remountUsed = false;
  controls.reset();
  acc = 0;
  hitstop = 0;
  slow = 0;
  atkBuffer = 0;
  lastCount = -1;
  lastGrudgeKos = 0;
}

/** The division pill and the nemesis card, over the countdown. */
function intro(): void {
  const nem = save.feud.nemesis;
  hud.setLeague(`${world.div.name} · race ${save.cup.race + 1}/${CUP_RACES}`);
  hud.setNemesis(nem, nem ? riderName(nem.id) : '', Math.round(REVENGE_PAY * world.div.prize));
}

function startRace(): void {
  if (!world) return; // still booting
  intro(); // the first race's ran behind the title
  unlockAudio();
  titleEl.classList.add('hidden');
  state = 'race';
  platform.lifecycle('level_started', { world: world.div.name, level: String(save.cup.race + 1) });
}

const near = (id: number) => id === 0 || Math.abs(world.riders[id].z - world.player.z) < 28;
const ordinal = (n: number) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

function handle(e: SimEvent): void {
  const w = world;
  switch (e.type) {
    case 'go':
      hud.flash('GO!', 'go');
      sfx.beep(true);
      break;
    case 'swing':
      view.riders[e.rider].swing(e.side, e.windup * C.DT);
      if (e.rider !== 0 && e.aim === 0) {
        hud.tell(e.rider, e.windup * C.DT);
        sfx.tell();
        setTimeout(() => sfx.whoosh(), Math.max(0, (e.windup - C.ATTACK.windup) * C.DT * 1000));
      } else if (near(e.rider)) sfx.whoosh();
      break;
    case 'whiff':
      if (e.dodged) {
        hud.flash('DODGED!', 'go');
        sfx.dodge();
      }
      break;
    case 'steal':
      if (e.from === 0) {
        hud.flash(e.took ? `STOLE A ${e.kind === 'pan' ? 'PAN' : 'BAT'}!` : 'KNOCKED IT LOOSE!', 'go');
        sfx.pickup();
      } else if (e.to === 0) hud.flash(e.took ? `${w.riders[e.from].name} TOOK YOUR ${e.kind === 'pan' ? 'PAN' : 'BAT'}!` : 'WEAPON KNOCKED LOOSE!', 'bad');
      break;
    case 'shove':
      if (e.from === 0) {
        slow = 0.6;
        view.shake(0.35);
        if (e.to === w.nemesis) hud.flash(`REVENGE! +$${Math.round(REVENGE_PAY * w.div.prize) + C.SHOVE_BONUS}`, 'ko');
        else if (w.grudgeKos > lastGrudgeKos) {
          lastGrudgeKos = w.grudgeKos;
          hud.flash(`GRUDGE SETTLED +$${C.GRUDGE_BONUS + C.SHOVE_BONUS}`, 'ko');
        } else hud.flash(`${e.into === 'car' ? 'INTO TRAFFIC!' : e.into === 'cones' ? 'INTO THE CONES!' : 'INTO THE WALL!'} +$${C.SHOVE_BONUS}`, 'ko');
      }
      break;
    case 'hit': {
      const v = w.riders[e.to];
      view.riders[e.to].hit(e.side, e.ko);
      view.fx.sparks(v.x - e.side * 0.3, 1.5, v.z, e.side, e.ko, rnd);
      view.fx.pow(v.x - e.side * 0.35, 1.55, v.z, e.ko);
      const mine = e.from === 0 || e.to === 0;
      if (mine) {
        hitstop = e.ko ? 0.1 : 0.055;
        view.shake(e.to === 0 ? 0.45 : 0.22);
      }
      if (near(e.to)) sfx.thunk(e.ko);
      if (e.from === 0 && e.counter && !e.ko) hud.flash('COUNTER!', 'ko');
      if (e.from === 0 && e.ko) {
        if (e.to === w.nemesis) hud.flash(`REVENGE! +$${Math.round(REVENGE_PAY * w.div.prize) + C.KO_BONUS}`, 'ko');
        else if (w.grudgeKos > lastGrudgeKos) {
          lastGrudgeKos = w.grudgeKos;
          hud.flash(`GRUDGE SETTLED +$${C.GRUDGE_BONUS + C.KO_BONUS}`, 'ko');
        } else hud.flash(`KO! +$${C.KO_BONUS}`, 'ko');
      }
      break;
    }
    case 'crash': {
      const r = w.riders[e.rider];
      view.riders[e.rider].setDown(true, e.vx < 0 ? -1 : 1);
      view.ragdolls[e.rider].throw(r.x, r.z, e.speed, e.vx, rnd, e.cause === 'car' ? 1.45 : e.cause === 'wall' || e.cause === 'cones' ? 1.2 : 1);
      if (e.cause === 'cones') view.scatterCones(r.x, r.z);
      view.fx.dust(r.x, r.z, e.speed, rnd);
      if (e.rider === 0) {
        slow = 0.55;
        view.shake(0.8);
        hud.flash(e.cause === 'car' ? 'WIPEOUT!' : e.cause === 'wall' ? 'SLAMMED!' : e.cause === 'cones' ? 'CONES!' : 'KNOCKED OFF!', 'bad');
      }
      if (near(e.rider)) sfx.crash();
      break;
    }
    case 'recover':
      view.riders[e.rider].setDown(false);
      view.ragdolls[e.rider].hide();
      break;
    case 'pickup':
      if (e.rider === 0) {
        hud.flash(e.kind === 'pan' ? 'FRYING PAN!' : 'BASEBALL BAT!', 'go');
        sfx.pickup();
      }
      break;
    case 'patrolWarn':
      hud.flash('SECURITY!', 'warn');
      sfx.siren();
      break;
    case 'patrolLetGo':
      hud.flash(`FINED $${e.fine} · MOVE ALONG`, 'warn');
      break;
    case 'hunt':
      hud.flash(`${w.riders[e.rider].name} is hunting you!`, 'warn');
      sfx.alarm();
      break;
    case 'ambush':
      hud.flash(e.riders.length > 1 ? 'THUGS AHEAD!' : 'THUG AHEAD!', 'warn');
      sfx.alarm();
      break;
    case 'grudge':
      hud.flash(`${w.riders[e.rider].name} holds a grudge!`, 'warn');
      break;
    case 'finish':
      if (e.rider === 0) {
        hud.flash(`${ordinal(e.place)} place!`, e.place === 1 ? 'go' : '');
        sfx.coin();
      }
      break;
    case 'over':
      finishRace();
      break;
    case 'rub':
      view.fx.scrape(e.x, e.z, rnd);
      if (e.player || Math.abs(e.z - w.player.z) < 20) sfx.scrape(e.player);
      break;
    case 'drop':
      break;
    case 'jump':
      if (near(e.rider)) sfx.whoosh();
      if (e.rider === 0) hud.flash('AIR!', 'go');
      break;
    case 'land':
      if (near(e.rider)) sfx.thunk(e.stomp >= 0);
      if (e.rider === 0) view.shake(e.stomp >= 0 ? 0.5 : 0.2);
      if (e.stomp >= 0 && e.rider === 0) {
        hitstop = 0.1;
        hud.flash(e.stomp === w.nemesis ? `REVENGE! +$${Math.round(REVENGE_PAY * w.div.prize) + C.KO_BONUS}` : `STOMPED ${w.riders[e.stomp].name}! +$${C.KO_BONUS}`, 'ko');
      } else if (e.stomp === 0) hud.flash(`${w.riders[e.rider].name} LANDED ON YOU!`, 'bad');
      break;
  }
}

function finishRace(): void {
  const w = world;
  const place = w.player.place;
  const of = (f: (r: (typeof w.riders)[number]) => number) => w.riders.map((r) => (r.thug ? 0 : f(r)));
  const s = settleRace(save, {
    place, kos: w.kos, grudgeKos: w.grudgeKos, shoves: w.shoves, fines: w.fines, grudges: [...w.grudges],
    places: of((r) => r.place), koPlayer: of((r) => r.koPlayer), koByPlayer: of((r) => r.koByPlayer),
  });
  storeSave(save);
  const table = s.table.map((t) => ({ name: riderName(t.id), pts: t.pts, rank: t.rank, me: t.id === 0 }));
  const res: RaceResult = {
    place, total: w.racers, prize: s.prize, kos: w.kos, koBonus: s.koBonus, grudgeKos: w.grudgeKos, grudgeBonus: s.grudgeBonus,
    shoves: w.shoves, shoveBonus: s.shoveBonus, fines: s.fines, earned: s.earned, time: w.time, grudges: save.grudges.map((id) => w.riders[id].name),
    league: { div: w.div.name, race: s.cupRace, races: CUP_RACES, table, end: s.end, next: C.stage(save.div, save.tier).name, season: C.TIERS[save.tier].name },
    feud: { out: s.feud, nemesis: save.feud.nemesis, name: riderName },
    double: s.earned > 0 && platform.rewardedReady() ? s.earned : 0,
    doubled: false,
  };
  state = 'results';
  platform.lifecycle(place <= C.PROMOTE ? 'level_completed' : 'level_failed', { world: w.div.name, level: String(s.cupRace) });
  const show = () => hud.showResults(res, save, buy, again, double, ride);
  const double = () => {
    void platform.showRewarded('double_cash').then((ok) => {
      if (ok && !res.doubled) {
        save.cash += res.earned;
        res.earned *= 2;
        res.doubled = true;
        storeSave(save);
        sfx.coin();
      }
      if (state === 'results') show();
    });
  };
  const buy = (k: UpKey) => {
    if (!buyUpgrade(save, k)) return;
    storeSave(save);
    sfx.coin();
    show();
  };
  const ride = (v: number) => {
    const had = save.cash;
    if (!chooseRide(save, v)) return;
    storeSave(save);
    if (save.cash < had) sfx.coin();
    show();
  };
  const again = () => {
    platform.interstitial('race_end');
    newRace();
    state = 'race';
    platform.lifecycle('level_started', { world: world.div.name, level: String(save.cup.race + 1) });
  };
  show();
}

function tick(): void {
  const inp = world.input;
  if (state === 'race' && BOT) {
    botInput(world, 0.8);
  } else if (state === 'race') {
    inp.targetX = controls.targetX;
    inp.steer = controls.steer;
    inp.brake = controls.brake;
    if (controls.attack) { atkBuffer = 8; controls.attack = false; }
    inp.attack = atkBuffer > 0;
  } else {
    inp.steer = 0;
    inp.brake = false;
    inp.attack = false;
  }
  recorder.capture(world);
  world.step();
  let swung = false;
  for (const e of world.events) {
    if (e.type === 'swing' && e.rider === 0) swung = true;
    handle(e);
  }
  world.events.length = 0;
  if (swung) atkBuffer = 0;
  else if (atkBuffer > 0) atkBuffer--;
  // countdown beeps
  if (world.countdown > 0) {
    const n = Math.ceil(world.countdown / C.TICK_HZ);
    if (n !== lastCount) {
      lastCount = n;
      hud.flash(String(n), 'count');
      sfx.beep(false);
    }
  }
}

function setPaused(on: boolean): void {
  if (state !== 'race' || paused === on) return;
  paused = on;
  hud.setPaused(on);
  suspendAudio(on || hostPaused);
}

platform.host.onPause = (on) => {
  hostPaused = on;
  suspendAudio(on || paused);
};
platform.host.onAudio = (on) => {
  hostMuted = !on;
  setMuted(hostMuted);
};

/** "Back on now": a rewarded ad puts a downed player straight back on the scooter, once a race. */
function remount(): void {
  if (remountUsed || state !== 'race' || world.player.state !== 'down') return;
  remountUsed = true;
  hud.showRemount(false);
  void platform.showRewarded('remount').then((ok) => {
    if (ok && state === 'race' && world.player.state === 'down') {
      world.input.remount = true;
      hud.flash('BACK ON!', 'go');
    } else if (!ok) remountUsed = false; // no ad, no charge
  });
}

controls.onPause = () => setPaused(!paused);
controls.onAny = () => unlockAudio();
hud.pauseBtn.addEventListener('click', () => setPaused(true));
hud.pauseResume.addEventListener('click', () => setPaused(false));
hud.remountBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); remount(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
titleEl.querySelector('button')!.addEventListener('click', startRace);
window.addEventListener('resize', () => { stage.resize(); hud.resize(); });

let lastT = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (paused || hostPaused) return;
  let simDt = dt;
  if (hitstop > 0) { hitstop -= dt; simDt = 0; }
  else if (slow > 0) { slow -= dt; simDt *= 0.35; }
  if (state !== 'title') {
    acc += simDt;
    let n = 0;
    while (acc >= C.DT && n++ < 8) { acc -= C.DT; tick(); }
  }
  view.update(simDt, Math.min(1, acc / C.DT));
  hud.update(world, view, save.cash, dt);
  hud.showHint(state === 'race' && save.races < 2 && world.time < 6);
  downClock = world.player.state === 'down' ? downClock + dt : 0;
  hud.showRemount(state === 'race' && !BOT && !remountUsed && downClock > 0.6 && platform.rewardedReady());
  if (statsEl) showStats(dt);
}

// ?stats: frame rate and what the GPU is asked to draw, for checking the art budget on a phone.
const statsEl = params.has('stats') ? document.body.appendChild(document.createElement('pre')) : null;
if (statsEl) statsEl.style.cssText = 'position:fixed;left:4px;bottom:4px;margin:0;padding:4px 6px;font:11px/1.3 monospace;color:#fff;background:#000a;pointer-events:none;z-index:99';
let statsT = 0;
let statsN = 0;
let statsWorst = 0;
function showStats(dt: number): void {
  statsT += dt;
  statsN++;
  statsWorst = Math.max(statsWorst, dt);
  if (statsT < 0.5) return;
  const r = stage.renderer.info;
  statsEl!.textContent = `${Math.round(statsN / statsT)} fps  worst ${Math.round(statsWorst * 1000)} ms\n` +
    `${r.render.calls} calls  ${(r.render.triangles / 1000).toFixed(1)}k tris\n` +
    `${r.memory.geometries} geos  ${r.memory.textures} tex  ${r.programs?.length ?? 0} progs`;
  statsT = statsN = statsWorst = 0;
}

async function boot(): Promise<void> {
  await platform.initPlatform();
  save = parseSave(await platform.loadData());
  hostMuted = !platform.audioEnabled();
  setMuted(hostMuted);
  newRace();
  const best = document.getElementById('best');
  if (best && save.races > 0) {
    best.textContent = `${C.stage(save.div, save.tier).name} · race ${save.cup.race + 1}/${CUP_RACES} · cash $${save.cash}` + (save.titles ? ` · ${save.titles}× champion` : '');
  }
  if (BOT) startRace();
  requestAnimationFrame(frame);
  platform.gameReady();
}
void boot();

// For poking at the game from the console while testing.
Object.assign(window, { __game: { get world() { return world; }, get view() { return view; }, get state() { return state; }, hud, get save() { return save; }, botInput, platform,
  /** Bug report: this race so far as a replay (seed, options, every input), JSON to paste. */
  replay: () => JSON.stringify(recorder.finish(world)) } });
