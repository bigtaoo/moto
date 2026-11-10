// Calm motion: no camera shake, no slow motion, a steadier speed zoom and the CSS pops toned down, for players
// who get queasy. Follows the system's "reduce motion" until the player picks in the pause menu.

export const SYSTEM_CALM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MOTION = { calm: SYSTEM_CALM };

/** `pick` is the player's choice from the save (null: follow the system). */
export function setCalm(pick: boolean | null): void {
  MOTION.calm = pick ?? SYSTEM_CALM;
  if (typeof document !== 'undefined') document.body.classList.toggle('calm', MOTION.calm);
}
