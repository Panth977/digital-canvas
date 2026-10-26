import type { Unit } from './types.ts';

/** CSS pixels per unit. */
export const PX_PER: Record<Unit, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

export function toPx(value: number, unit: Unit): number {
  return value * PX_PER[unit];
}

export function fromPx(px: number, unit: Unit): number {
  return px / PX_PER[unit];
}

/** A length shown to the user: px whole, everything else to 2 decimals. */
export function formatLength(px: number, unit: Unit): string {
  const v = fromPx(px, unit);
  return unit === 'px' ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
}

/** Canva's custom-size limits: 40 px to 8000 px per side. */
export const MIN_SIDE = 40;
export const MAX_SIDE = 8000;
