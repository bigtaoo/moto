import { describe, it, expect } from 'vitest';
import { PerfSampler, RunStutter, careerBucket, stepId, stepIndex, deviceFields, at, SAMPLE_MS } from './metrics';

describe('PerfSampler', () => {
  it('sends a sample once 30 s of frames are in, with the guide fields', () => {
    let t = 0;
    const s = new PerfSampler('1.0', () => t);
    let out = null;
    for (let i = 0; i < 2000 && !out; i++) {
      const ms = i % 100 === 0 ? 120 : 16;
      t += ms;
      out = s.frame(ms);
    }
    expect(out).not.toBeNull();
    const p = out!;
    expect(p.active_ms).toBeGreaterThanOrEqual(SAMPLE_MS);
    expect(p.target_fps).toBe(60);
    expect(p.frame_time_p50_ms).toBe(16);
    expect(p.frame_time_max_ms).toBe(120);
    expect(p.frames_over_100ms).toBeGreaterThan(0);
    expect(p.frames_over_250ms).toBe(0);
    expect(p.build_version).toBe('1.0');
    for (const k of ['window_ms', 'frame_count', 'fps_avg', 'fps_p10', 'frame_time_p95_ms', 'frame_time_p99_ms', 'frames_over_50ms', 'frames_over_500ms', 'frames_over_1000ms']) expect(p).toHaveProperty(k);
  });

  it('drops gaps, sends a short window only past 5 s, and skips the frame after a flush', () => {
    let t = 0;
    const s = new PerfSampler('x', () => t);
    expect(s.frame(9000)).toBeNull(); // a hidden-tab gap is not a frame
    for (let i = 0; i < 100; i++) s.frame(16);
    expect(s.flush()).toBeNull(); // 1.6 s: too short
    s.frame(800); // spans the time away: skipped
    for (let i = 0; i < 400; i++) { t += 16; s.frame(16); }
    const p = s.flush()!;
    expect(p.frame_count).toBe(400);
    expect(p.frame_time_max_ms).toBe(16);
  });

  it('takes percentiles by nearest rank', () => {
    expect(at([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(at([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(at([7], 0.99)).toBe(7);
  });
});

describe('RunStutter', () => {
  it('counts a race\'s long frames and leaves out the one after time away', () => {
    const r = new RunStutter();
    r.frame(16);
    r.frame(300);
    r.away();
    r.frame(2000);
    r.frame(1200);
    const f = r.fields();
    expect(f.run_frame_count).toBe(3);
    expect(f.run_frame_max_ms).toBe(1200);
    expect(f.run_frames_over_250ms).toBe(2);
    expect(f.run_frames_over_1000ms).toBe(1);
    expect(f).not.toHaveProperty('run_frames_over_50ms');
    r.reset();
    expect(r.fields().run_frame_count).toBe(0);
  });
});

describe('dimensions', () => {
  it('buckets the career', () => {
    expect([0, 1, 4, 5, 19, 20, 99, 100, 5000].map(careerBucket)).toEqual(['0', '1-4', '1-4', '5-19', '5-19', '20-49', '50-99', '100+', '100+']);
  });

  it('names 15 bounded steps and orders every race on the ladder', () => {
    expect(stepId(0, 0)).toBe('amateur_rookie_cup');
    expect(stepId(4, 2)).toBe('legend_neon_coast');
    expect(stepId(99, -3)).toBe('amateur_neon_coast');
    const ids = new Set<string>();
    for (let tier = 0; tier < 3; tier++) for (let div = 0; div < 5; div++) ids.add(stepId(div, tier));
    expect(ids.size).toBe(15);
    expect(stepIndex(0, 0, 1, 4)).toBe(1);
    expect(stepIndex(4, 2, 4, 4)).toBe(60);
  });

  it('tells the device family, an iPad by its touch points', () => {
    expect(deviceFields('Mozilla/5.0 (Windows NT 10.0)', 0, 'desktop')).toEqual({ device: 'desktop', form: 'desktop', touch: false });
    expect(deviceFields('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5, null)).toEqual({ device: 'ios', form: 'unknown', touch: true });
    expect(deviceFields('Mozilla/5.0 (Linux; Android 14)', 5, 'mobile').device).toBe('android');
  });
});
