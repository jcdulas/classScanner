// Chooses the font of each text of the diagram, so that text is sharp (spec §4.1).
//
// Two kinds of bitmap fonts exist:
//   - the scalable fonts of fonts.ts, drawn once and scaled to any size: always available,
//     a little blurred;
//   - pixel fonts (pixelFontAtlas.ts), drawn for one exact size on screen: sharp, but only
//     at that size, and only when the text starts on a whole pixel.
//
// The size of a text on screen depends on the zoom. So this class is given a "target": the
// zoom and the pixel density that the diagram is drawn with. It creates pixel fonts for
// that target on demand, and `snap` moves a coordinate to the nearest pixel of that target.
// When the target changes, the renderer creates the texts again, then the fonts that are
// no longer used are released. While the user is zooming, texts keep the fonts of the
// previous zoom, scaled: they are sharp again as soon as the zoom stops.

import { BitmapFont } from 'pixi.js';
import { CARD_FONTS, CardFontStyle } from './fonts';
import { canDrawWithPixelFont, installPixelFont, uninstallPixelFont } from './pixelFontAtlas';

/**
 * Below this zoom, the text of the cards is under 6 screen pixels tall: scalable fonts are
 * used. A sharp font would not make it readable, and creating the texts again at every zoom
 * change would be slow, as hundreds of cards are then in view.
 */
const MIN_CAMERA_SCALE = 0.5;
/** Pixel fonts are not made outside of these sizes, in pixels: too small to matter, or a needlessly large atlas. */
const MIN_PIXEL_SIZE = 5;
const MAX_PIXEL_SIZE = 160;

export class PixelFonts {
  /** Zoom that pixel fonts are made for, or 0 when the text of the cards uses scalable fonts. */
  private cameraScale = 0;
  /** Device pixels per CSS pixel. */
  private currentPixelRatio = 1;
  private readonly installed = new Map<string, BitmapFont>();
  /** Names of the fonts asked for since the last change of target. */
  private usedNames = new Set<string>();

  /** `fontFamily` is the CSS font family of the characters, the same as for the scalable fonts. */
  constructor(private readonly fontFamily: string) {}

  get pixelRatio(): number {
    return this.currentPixelRatio;
  }

  /**
   * Sets the zoom and the pixel density that the next texts are drawn for. Returns false when
   * the fonts stay the same: the existing texts can then be kept.
   */
  setTarget(cameraScale: number, pixelRatio: number): boolean {
    const newScale = cameraScale >= MIN_CAMERA_SCALE ? cameraScale : 0;
    if (newScale === this.cameraScale && pixelRatio === this.currentPixelRatio) {
      return false;
    }
    this.cameraScale = newScale;
    this.currentPixelRatio = pixelRatio;
    this.usedNames = new Set();
    return true;
  }

  /** The font of a text that is `fontSize` world units tall and zooms with the diagram. */
  fontFor(style: CardFontStyle, fontSize: number, text: string): string {
    if (this.cameraScale === 0) {
      return CARD_FONTS[style];
    }
    return this.fontOfPixelSize(style, fontSize * this.cameraScale * this.currentPixelRatio, text);
  }

  /** The font of a text that stays `screenSize` CSS pixels tall at every zoom. */
  fontForScreenSize(style: CardFontStyle, screenSize: number, text: string): string {
    return this.fontOfPixelSize(style, screenSize * this.currentPixelRatio, text);
  }

  /**
   * Moves a world coordinate to the nearest pixel of the target. Positions of texts and of
   * their parents go through this, so that characters fall on whole pixels. Without pixel
   * fonts the coordinate is returned unchanged.
   */
  snap(worldCoordinate: number): number {
    if (this.cameraScale === 0) {
      return worldCoordinate;
    }
    const pixelsPerUnit = this.cameraScale * this.currentPixelRatio;
    return Math.round(worldCoordinate * pixelsPerUnit) / pixelsPerUnit;
  }

  /**
   * Releases the fonts that were not asked for since the last change of target. To call once
   * every text was created again: a text must not keep a released font.
   */
  releaseUnusedFonts(): void {
    for (const [name, font] of this.installed) {
      if (!this.usedNames.has(name)) {
        uninstallPixelFont(name, font);
        this.installed.delete(name);
      }
    }
  }

  private fontOfPixelSize(style: CardFontStyle, pixelSize: number, text: string): string {
    // A character missing from the atlas, such as an accented letter in an identifier, would
    // not be drawn: scalable fonts add characters on demand.
    if (pixelSize < MIN_PIXEL_SIZE || pixelSize > MAX_PIXEL_SIZE || !canDrawWithPixelFont(text)) {
      return CARD_FONTS[style];
    }
    const name = `${CARD_FONTS[style]}-${pixelSize}px`;
    this.usedNames.add(name);
    if (!this.installed.has(name)) {
      const font = installPixelFont({
        name,
        fontFamily: this.fontFamily,
        fontWeight: style === 'bold' ? 'bold' : 'normal',
        fontStyle: style === 'italic' ? 'italic' : 'normal',
        pixelSize,
      });
      this.installed.set(name, font);
    }
    return name;
  }
}
