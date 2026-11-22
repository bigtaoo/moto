import { describe, it, expect } from 'vitest';
import { compose, Renderer, TARGET_RMS, PEAK_CEIL } from './tune';

describe('race tunes made in code', () => {
  it('is the same tune for the same seed, and a different one for another', () => {
    expect(compose({ seed: 5 })).toEqual(compose({ seed: 5 }));
    expect(compose({ seed: 5 }).notes).not.toEqual(compose({ seed: 6 }).notes);
  });

  it('keeps every voice in a sane range, the lead singable and inside the loop', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const boss of [false, true]) {
        const s = compose({ seed, boss });
        expect(s.bpm).toBeGreaterThanOrEqual(boss ? 132 : 112);
        expect(s.bpm).toBeLessThanOrEqual(boss ? 148 : 128);
        expect(s.secs).toBeGreaterThan(25);
        expect(s.secs).toBeLessThan(36);
        const lead = s.notes.filter((n) => n.v === 'lead');
        expect(lead.length).toBeGreaterThan(60);
        for (const n of s.notes) {
          expect(n.at).toBeGreaterThanOrEqual(0);
          expect(n.at).toBeLessThan(s.secs);
        }
        for (const n of lead) {
          expect(n.midi).toBeGreaterThanOrEqual(52); // E3
          expect(n.midi).toBeLessThanOrEqual(84); // C6
        }
        for (const n of s.notes.filter((n) => n.v === 'bass')) {
          expect(n.midi).toBeGreaterThanOrEqual(28);
          expect(n.midi).toBeLessThanOrEqual(64);
        }
        // no leap over an octave between lead notes
        for (let i = 1; i < lead.length; i++) expect(Math.abs(lead[i].midi - lead[i - 1].midi)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('renders a slice at a time to finite samples, at the level it aims for and never clipping', () => {
    for (const boss of [false, true]) {
      const r = new Renderer(compose({ seed: 3, boss }), 22050);
      let slices = 0;
      while (!r.done) { r.step(24); slices++; }
      expect(slices).toBeGreaterThan(10);
      let m = 0;
      let sq = 0;
      let bad = 0;
      let hot = 0;
      for (const v of r.out) { if (!Number.isFinite(v)) bad++; m = Math.max(m, Math.abs(v)); sq += v * v; if (Math.abs(v) > 0.7) hot++; }
      expect(bad).toBe(0);
      expect(m).toBeLessThanOrEqual(PEAK_CEIL + 0.01);
      // 3.3.74: the level is whichever of the two limits bites first, and for a band with this crest factor
      // it is the ceiling -- so the RMS lands well under TARGET_RMS, and that is the point. Loud enough to
      // carry (MUSIC_VOL makes up the rest), not so loud that the peaks have to be squashed to fit.
      const rms = Math.sqrt(sq / r.out.length);
      expect(rms).toBeGreaterThan(0.1);
      expect(rms).toBeLessThanOrEqual(TARGET_RMS + 0.01);
      // 3.3.67: only the peaks are rounded off. When the last pass was a tanh over everything, a twentieth
      // of the track sat up in the bend; a loop that spends a whole race in there is the thing that grates.
      // With the ceiling in the gain there is now next to nothing for the knee to catch at all.
      expect(hot / r.out.length).toBeLessThan(0.005);
    }
  });

  it('leaves the loop somewhere to go: the bass rests and the arp waits for the climb', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = compose({ seed });
      const bars = Math.round(s.secs / (s.bpm ? (60 / s.bpm) * 4 : 1));
      const bass = s.notes.filter((n) => n.v === 'bass');
      expect(bass.length).toBeLessThan(bars * 7); // not all eight eighths of every bar
      const arp = s.notes.filter((n) => n.v === 'arp');
      expect(Math.min(...arp.map((n) => n.at))).toBeGreaterThan(s.secs * 0.6);
    }
  });
});
