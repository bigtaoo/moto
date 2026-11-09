import { World } from '../src/sim/world';
import { botInput } from '../src/sim/ai';
const cause: Record<string, number> = {};
const rivalCause: Record<string, number> = {};
const hitsOnPlayer: number[] = [];
for (let seed = 1; seed <= 20; seed++) {
  const w = new World({ seed });
  let hp = 0;
  while (!w.over) {
    botInput(w, 1); w.step();
    for (const e of w.events) {
      if (e.type === 'crash') (e.rider === 0 ? cause : rivalCause)[e.cause] = ((e.rider === 0 ? cause : rivalCause)[e.cause] ?? 0) + 1;
      if (e.type === 'hit' && e.to === 0) hp++;
    }
    w.events.length = 0;
  }
  hitsOnPlayer.push(hp);
}
console.log('player crashes/20', cause, 'rival crashes/20', rivalCause, 'hits on player avg', hitsOnPlayer.reduce((a, b) => a + b) / 20);
