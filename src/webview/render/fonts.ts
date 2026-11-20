// Fonts used on the cards (spec §4.1).
//
// Drawing text in WebGL is costly if every label is its own texture. PixiJS
// "bitmap fonts" draw each character once into a shared texture (an atlas)
// and then build every label from rectangles of that texture, so thousands of
// labels cost almost nothing. The characters are drawn in white and colored
// per label with `tint`.
//
// The fonts installed here are drawn once, large (FONT_TEXTURE_SIZE), and scaled
// to the size of each text. They work at every zoom but scaling blurs them a
// little, so readable text uses the fonts of pixelFonts.ts instead, which are
// drawn for the exact size of the text on screen.

import { BitmapFont } from 'pixi.js';
import { CARD_STYLE, FontMetrics } from '../model/cardGeometry';

export type CardFontStyle = 'regular' | 'bold' | 'italic';

/** Names of the scalable fonts. */
export const CARD_FONTS: Record<CardFontStyle, string> = {
  regular: 'card-regular',
  bold: 'card-bold',
  italic: 'card-italic',
};

const FONT_TEXTURE_SIZE = 32;
const FALLBACK_FONT_FAMILY = 'Consolas, "Courier New", monospace';

/** The monospace font family of the VS Code editor, as set by the user. */
export function editorFontFamily(): string {
  const family = getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family').trim();
  return family === '' ? FALLBACK_FONT_FAMILY : `${family}, monospace`;
}

/** Installs the scalable bitmap fonts and returns the measured width of one character. */
export function installCardFonts(fontFamily: string): FontMetrics {
  // Printable ASCII plus the characters used in card decorations. Others are added on demand.
  const characters = [[' ', '~'], '«»…'];
  const install = (name: string, fontWeight: 'normal' | 'bold', fontStyle: 'normal' | 'italic') => {
    BitmapFont.install({
      name,
      chars: characters,
      resolution: 1,
      padding: 4,
      style: { fontFamily, fontSize: FONT_TEXTURE_SIZE, fill: 0xffffff, fontWeight, fontStyle },
    });
  };
  install(CARD_FONTS.regular, 'normal', 'normal');
  install(CARD_FONTS.bold, 'bold', 'normal');
  install(CARD_FONTS.italic, 'normal', 'italic');
  return { charWidth: measureCharacterWidth(fontFamily) };
}

function measureCharacterWidth(fontFamily: string): number {
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = `${CARD_STYLE.memberFontSize}px ${fontFamily}`;
  const sample = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return context.measureText(sample).width / sample.length;
}
