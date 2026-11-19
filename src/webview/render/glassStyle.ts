// Helpers for the "glass" look of the cards and groups drawn with PixiJS.
//
// Real glass blurs what is behind it, which is too costly to do in WebGL for
// 1500 cards. The look is suggested instead with cheap shapes: a soft shadow
// under the card, a slightly see-through body, a header with a top-to-bottom
// gradient, and a thin bright rim inside the border, as if lit from above.

import { FillGradient } from 'pixi.js';

// A gradient is a small texture. One texture is shared by all the shapes that use the same
// two colors, so 1500 cards in 12 group colors only need 12 textures.
const gradientCache = new Map<string, FillGradient>();

/** A vertical gradient relative to the shape it fills: `topColor` at its top, `bottomColor` at its bottom. */
export function verticalGradient(topColor: number, bottomColor: number): FillGradient {
  const key = `${topColor}-${bottomColor}`;
  let gradient = gradientCache.get(key);
  if (gradient === undefined) {
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: topColor },
        { offset: 1, color: bottomColor },
      ],
      textureSpace: 'local',
    });
    gradientCache.set(key, gradient);
  }
  return gradient;
}

/** Mixes a color with white (amount from 0 to 1). */
export function lighten(color: number, amount: number): number {
  return mixColors(color, 0xffffff, amount);
}

/** Mixes a color with black (amount from 0 to 1). */
export function darken(color: number, amount: number): number {
  return mixColors(color, 0x000000, amount);
}

function mixColors(first: number, second: number, amount: number): number {
  const mixChannel = (shift: number) => {
    const from = (first >> shift) & 0xff;
    const to = (second >> shift) & 0xff;
    return Math.round(from + (to - from) * amount) << shift;
  };
  return mixChannel(16) | mixChannel(8) | mixChannel(0);
}
