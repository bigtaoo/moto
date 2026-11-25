// The rival name tags: a chip over each rider's head, placed against the screen once a frame. Split out
// of hud.ts on 2026-11-23, which the 500-line cap had caught up with; the rest of the HUD stayed there.

import type { World } from '../sim/world';
import type { RaceView } from './scene';
import { t } from '../i18n';

/** A rival tag's height plus a hair of air: the step a tag is lifted to clear one already placed. */
const TAG_H = 20;
/** Tags are solid to here, then fade to TAG_FAINT at the end of the draw range (3.3.66). */
const TAG_NEAR = 14;
const TAG_FAR = 45;
const TAG_FAINT = 0.28;
/** A tag at TAG_FAINT is drawn this much of full size, so distance thins the names instead of only dimming them. */
const TAG_SMALL = 0.72;
/** Rows a tag may be lifted to clear one already placed; one that still lands on a name is dropped instead. */
const TAG_ROWS = 2;
/**
 * A tag is only lifted while its rider is this near. Measured in the build, landscape 1280x631: the road's
 * horizon is on row 243, and a rider 8 m ahead has its head on row 299 with its name just above that --
 * lift that name one row and it lands on 237, out over the far road where the next car appears. Nearer
 * than this the lift stays well under the horizon and earns its keep; further out the name stands down for
 * the frame instead, which is 3.3.66's rule once more: the road is worth more than the name.
 */
const TAG_LIFT = 7;
/**
 * A name is a chip of one size while the rider it names shrinks with distance: on that same screen a rider
 * draws 51 px across at 4 m and 27 at 14, against a 60 px chip, so from about six metres out the name
 * covers more road than the body it belongs to. Between these two the chip is drawn down to TAG_SMALL --
 * not to the rider's own width, which would leave the text unreadable, but far enough that it stops being
 * the widest thing on that stretch of road.
 */
const TAG_WIDE = 6;
const TAG_WIDE_FULL = 11;

/** Set a class only when it would change: a no-op `toggle` still dirties the element's style. (hud.ts has the twin.) */
const cls = (el: HTMLElement, name: string, on: boolean) => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};

export class Tags {
  private readonly labels: HTMLElement[] = [];
  /** Each rival tag's last screen spot, in tenths of a pixel: the transform is written only when it moves. */
  private tagX: number[] = [];
  private tagY: number[] = [];
  /** Each tag's drawn opacity, in twentieths, or -1 for a tag that is off (3.3.66). */
  private tagA: number[] = [];
  /** Each tag's width, measured once when the race's tags are built. */
  private tagW: number[] = [];
  /** Each tag's drawn scale, in hundredths: the transform carries it, so a change there has to rewrite it. */
  private tagS: number[] = [];
  /** Scratch for the tags already placed this frame: x, y, half-width per tag. */
  private readonly placed: number[] = [];
  /** The HUD's width: a tag is kept inside it, so a name never hangs off the screen. */
  private roomW = 0;
  private readonly pt = { x: 0, y: 0 };

  /** `box`: the HUD's `.labels` layer, which clips whatever hangs over its edge. */
  constructor(private readonly box: HTMLElement) {}

  /** One tag per rider, built for the race. */
  setup(w: World): void {
    for (const l of this.labels) l.remove();
    this.labels.length = 0;
    for (const r of w.riders) {
      const l = document.createElement('div');
      l.className = r.thug ? 'tag thug' : r.boss ? 'tag boss' : 'tag';
      l.textContent = r.isPlayer ? '' : r.boss ? `${t('bossTag')} · ${r.name}` : r.name;
      this.box.appendChild(l);
      this.labels.push(l);
    }
    this.tagX = w.riders.map(() => NaN);
    this.tagY = w.riders.map(() => NaN);
    this.tagA = w.riders.map(() => -1);
    this.tagS = w.riders.map(() => -1);
    this.tagW = this.labels.map((l) => l.offsetWidth); // one layout per race, read before anything moves
  }

  resize(roomW: number): void {
    this.roomW = roomW;
    this.tagX.fill(NaN);
  }

  /** `tellT`: per rider, the clock hud.ts keeps on a swing of theirs that has been telegraphed. */
  update(w: World, view: RaceView, tellT: number[]): void {
    const p = w.player;
    // Two riders side by side used to print their names over each other, one name
    // unreadable under the other; a tag that would land on one already placed is lifted a row instead.
    // The order is the rider list, not the distance, so a pair trading places never makes them flicker.
    const placed = this.placed;
    placed.length = 0;
    // Two sweeps of the list: the rivals carrying something to act on claim their spot first. Out past
    // TAG_LIFT only one name of a bunch is kept, and it had better be the nemesis rather than whoever the
    // rider list reaches first. A flag turns on at an event, not per frame, so this does not flicker.
    for (let pass = 0; pass < 2; pass++)
    for (let i = 1; i < w.riders.length; i++) {
      const r = w.riders[i];
      const dz = r.z - p.z;
      const nem = r.id === w.nemesis;
      const grudge = !nem && w.grudges.has(r.id);
      const hunt = r.huntT > 0;
      const tell = tellT[i] > 0;
      const open = r.openT > 0 && !tell;
      const flag = nem || grudge || hunt || tell || open || r.boss;
      if (flag !== (pass === 0)) continue;
      const l = this.labels[i];
      // Past arm's reach a name is worth no more than the road it covers, and the road up there is where
      // the player reads their lane and the traffic coming down it. Out of reach only the rivals carrying
      // something to act on keep a tag; the rest of the pack rides anonymously and the lane stays clear.
      const worth = dz <= TAG_NEAR || flag;
      const show = worth && r.state === 'ride' && dz > -6 && dz < 45 && view.projectRider(i, 2.55, this.pt);
      l.classList.toggle('on', show);
      if (!show) {
        // the inline fade would otherwise keep a hidden tag visible: `.tag` hides by opacity
        if (this.tagA[i] !== -1) { this.tagA[i] = -1; l.style.opacity = ''; }
        continue;
      }
      // 3.3.66: eight tags at full strength made the far half of the road a wall of names, and the two or
      // three riders the player can actually reach read no louder than the pack 40 m up the road. The near
      // ones stay solid; past 14 m the tag thins out to a quarter by the time it leaves the draw range.
      const fade = dz <= TAG_NEAR ? 1 : Math.max(TAG_FAINT, 1 - ((dz - TAG_NEAR) / (TAG_FAR - TAG_NEAR)) * (1 - TAG_FAINT));
      // quantized, so a tag rewrites its opacity about twenty times over the whole fade, not every frame
      const step = Math.round(fade * 20);
      const refade = step !== this.tagA[i];
      if (refade) { this.tagA[i] = step; l.style.opacity = String(step / 20); }
      cls(l, 'nem', nem);
      cls(l, 'grudge', grudge);
      cls(l, 'hunt', hunt);
      cls(l, 'tell', tell);
      cls(l, 'open', open);
      // The far ones shrink as well as fade: eight chips of one size read as a row of buttons pasted over
      // the road, where a name that is both smaller and fainter falls back into the distance with its
      // rider. The chip starts shrinking at TAG_WIDE, well before the fade starts at TAG_NEAR, because it
      // outgrows its rider long before it is far enough to be worth dimming.
      const sized = Math.max(0, Math.min(1, (TAG_WIDE_FULL - dz) / (TAG_WIDE_FULL - TAG_WIDE)));
      const s = TAG_SMALL + (1 - TAG_SMALL) * Math.min(fade, sized);
      // an icon class adds its 1em badge in front of the name, which the measured width predates. Scaled,
      // because that width was measured at full size and the chip is drawn at `s`: against the unscaled
      // number every test below -- the clamp to the screen edge, the player's box, the stacking -- holds
      // room for a chip that is no longer that wide, and names part, or stand down, over an overlap that
      // is not there. At twelve metres that is 60 px of claim for a name drawn 43 px across.
      const half = ((this.tagW[i] + (nem || grudge || hunt || tell || open ? 15 : 0)) / 2) * s + 3;
      // A rider at the edge of the road used to get a tag half off the screen (`.labels` clips it), so the
      // name was cut in two. Held inside the screen instead: it still sits over its rider, just not past the
      // edge. Clamped before the stacking pass, so two tags pushed to the same corner still part vertically.
      const lo = half + 4, hi = this.roomW - half - 4;
      let x = hi > lo ? Math.max(lo, Math.min(hi, this.pt.x)) : this.pt.x, y = this.pt.y;
      // No name goes over the player's own dummy. A rival a metre or two behind is drawn below and in
      // front of them, so its tag -- which hangs above its head -- lands square on the player's chest,
      // and the player loses sight of the one thing on the screen they steer by. The tag steps up to just
      // clear of their helmet instead; the stacking pass below then parts it from any other name up there.
      const pb = view.pbox;
      if (pb.ok && y > pb.top && y - TAG_H < pb.bot && Math.abs(x - pb.x) < half + pb.half) y = pb.top - 3;
      // Far out, the lift is itself what puts a name over the road (TAG_LIFT): there a tag gets no rows at
      // all, so one that lands on a name already placed stands down instead of climbing over the horizon.
      const lift = dz <= TAG_LIFT ? TAG_ROWS : 0;
      let rows = 0;
      for (; rows <= lift; rows++) {
        let hit = false;
        for (let k = 0; k < placed.length; k += 3) {
          if (Math.abs(x - placed[k]) < half + placed[k + 2] && Math.abs(y - placed[k + 1]) < TAG_H) {
            hit = true;
            y = placed[k + 1] - TAG_H;
          }
        }
        if (!hit) break;
      }
      if (rows > lift) {
        // Another row would put the name further above its rider, out over the road the player is reading.
        // The road is worth more than the name: this one stands down for the frame.
        l.classList.remove('on');
        if (this.tagA[i] !== -1) { this.tagA[i] = -1; l.style.opacity = ''; }
        continue;
      }
      placed.push(x, y, half);
      const sq = Math.round(s * 100);
      const tx = Math.round(x * 10), ty = Math.round(y * 10);
      if (!refade && sq === this.tagS[i] && tx === this.tagX[i] && ty === this.tagY[i]) continue;
      this.tagX[i] = tx;
      this.tagY[i] = ty;
      this.tagS[i] = sq;
      l.style.transform = `translate(${tx / 10}px, ${ty / 10}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
    }
  }
}
