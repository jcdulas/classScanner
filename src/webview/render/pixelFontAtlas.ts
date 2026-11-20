// Builds a bitmap font whose characters are drawn at one exact size in pixels (spec §4.1).
//
// The bitmap fonts that PixiJS generates (fonts.ts) are drawn once, large, and scaled to
// the size of each text. Scaling blurs small text, because the pixels of a character no
// longer fall on the pixels of the screen. The fonts built here are made for one size on
// screen: when a text uses a font of exactly its size and starts on a whole pixel, each
// pixel of the atlas lands on one pixel of the screen, and the text is as sharp as text
// drawn by the browser.
//
// The browser draws the characters into a canvas (the "atlas"), one character per cell of
// a grid. Each character starts on a whole pixel, which lets the browser fit its strokes
// to the pixel grid ("hinting"). PixiJS cannot be asked for this: its own generator places
// characters at fractions of a pixel.

import { BitmapFont, BitmapFontData, Cache, ImageSource, Texture } from 'pixi.js';

/** Printable ASCII, plus the characters used in card decorations. */
const ATLAS_CHARACTERS = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).concat(['«', '»', '…']);
const ATLAS_CHARACTER_SET = new Set(ATLAS_CHARACTERS);
const ATLAS_COLUMNS = 16;
/** Size at which the height of the font is measured, like PixiJS does, so that both kinds of fonts place text alike. */
const METRICS_FONT_SIZE = 100;
/** A text with accents and descenders, to measure how far characters go above and below the baseline. */
const METRICS_SAMPLE = '|ÉqÅ';

export interface PixelFontOptions {
  /** Name to give to the `fontFamily` of a BitmapText. */
  name: string;
  /** CSS font family the characters are drawn with. */
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  /** Height of the font in pixels of the screen. It does not have to be a whole number. */
  pixelSize: number;
}

/** True when every character of the text is in the atlas of a pixel font. */
export function canDrawWithPixelFont(text: string): boolean {
  for (const character of text) {
    if (!ATLAS_CHARACTER_SET.has(character)) {
      return false;
    }
  }
  return true;
}

/** Creates the font and registers it in PixiJS under `options.name`. */
export function installPixelFont(options: PixelFontOptions): BitmapFont {
  const cssFont = (size: number) => `${options.fontStyle} ${options.fontWeight} ${size}px ${options.fontFamily}`;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;

  // The baseline is a whole number of pixels below the top of a text, so that characters are not blurred vertically.
  context.font = cssFont(METRICS_FONT_SIZE);
  const sample = context.measureText(METRICS_SAMPLE);
  const baseline = Math.round((sample.actualBoundingBoxAscent / METRICS_FONT_SIZE) * options.pixelSize);

  context.font = cssFont(options.pixelSize);
  const advances = ATLAS_CHARACTERS.map((character) => context.measureText(character).width);
  // Room around each character for what goes outside of its box: accents, slanted italics.
  const margin = Math.ceil(options.pixelSize * 0.3) + 2;
  const cellWidth = Math.ceil(Math.max(...advances)) + margin * 2;
  const cellHeight = Math.ceil(options.pixelSize * 1.3) + margin * 2;
  canvas.width = cellWidth * ATLAS_COLUMNS;
  canvas.height = cellHeight * Math.ceil(ATLAS_CHARACTERS.length / ATLAS_COLUMNS);

  // Resizing a canvas resets its drawing state. Characters are white: each text colors them with its tint.
  context.font = cssFont(options.pixelSize);
  context.fillStyle = '#ffffff';
  context.textBaseline = 'alphabetic';

  // The description of the atlas in the format of bitmap font files, which PixiJS reads.
  const data: BitmapFontData = {
    fontFamily: options.name,
    fontSize: options.pixelSize,
    lineHeight: options.pixelSize,
    baseLineOffset: 0,
    pages: [{ id: 0, file: '' }],
    chars: {},
  };
  ATLAS_CHARACTERS.forEach((character, index) => {
    const cellX = (index % ATLAS_COLUMNS) * cellWidth;
    const cellY = Math.floor(index / ATLAS_COLUMNS) * cellHeight;
    context.fillText(character, cellX + margin, cellY + margin + baseline);
    data.chars[character] = {
      id: character.codePointAt(0)!,
      letter: character,
      page: 0,
      x: cellX,
      y: cellY,
      width: cellWidth,
      height: cellHeight,
      // The cell starts `margin` pixels before the character.
      xOffset: -margin,
      yOffset: -margin,
      xAdvance: advances[index],
      kerning: {},
    };
  });

  // Smaller copies of the atlas (mipmaps) keep the text smooth while the user zooms out,
  // until the font of the new zoom replaces this one.
  const source = new ImageSource({ resource: canvas, alphaMode: 'premultiply-alpha-on-upload', autoGenerateMipmaps: true });
  const font = new BitmapFont({ data, textures: [new Texture({ source })] });
  Cache.set(cacheKeyOf(options.name), font);
  return font;
}

export function uninstallPixelFont(name: string, font: BitmapFont): void {
  Cache.remove(cacheKeyOf(name));
  font.destroy();
}

/** The key under which PixiJS looks for the bitmap font of a `fontFamily`. */
function cacheKeyOf(name: string): string {
  return `${name}-bitmap`;
}
