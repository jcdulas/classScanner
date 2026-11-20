// Draws one class card with PixiJS (spec §4.2, §4.3).
//
// A card is a container holding a background (a Graphics object: rounded
// rectangle, colored header band, separators) and, when it is close enough
// to read, a "content" container with the text. The content is created only
// when the card becomes visible at a level that shows text, and destroyed as
// soon as it leaves the screen: text objects only exist for the few dozen
// cards on screen, never for the whole diagram.
//
// Texts take their font from PixelFonts and are placed on whole pixels, which
// keeps them sharp (see pixelFonts.ts).

import { BitmapText, Container, Graphics } from 'pixi.js';
import { Visibility } from '../../shared/graphModel';
import { CARD_STYLE, CardLayout, CardRow, FontMetrics } from '../model/cardGeometry';
import { CARD_FONTS, CardFontStyle } from './fonts';
import { darken, lighten, verticalGradient } from './glassStyle';
import { CardContent } from './levelOfDetail';
import { PixelFonts } from './pixelFonts';
import { Theme, contrastingTextColor } from './theme';

const DIMMED_ALPHA = 0.25;
/** Radius of the circle drawn before an attribute; the diamond of a method is slightly larger. */
const MEMBER_ICON_SIZE = 3.5;

export class CardView {
  readonly container = new Container();
  private readonly background = new Graphics();
  private content: Container | null = null;
  private contentKind: CardContent = 'none';
  private isSelected = false;

  constructor(
    readonly id: string,
    private layout: CardLayout,
    private headerColor: number,
    private theme: Theme,
    private readonly metrics: FontMetrics,
    private readonly isAbstract: boolean,
    private readonly fonts: PixelFonts,
  ) {
    this.container.addChild(this.background);
    this.drawBackground();
  }

  get cardLayout(): CardLayout {
    return this.layout;
  }

  get shownContent(): CardContent {
    return this.contentKind;
  }

  setLayout(layout: CardLayout): void {
    if (layout === this.layout) {
      return;
    }
    this.layout = layout;
    this.rebuild();
  }

  setStyle(theme: Theme, headerColor: number): void {
    if (theme === this.theme && headerColor === this.headerColor) {
      return;
    }
    this.theme = theme;
    this.headerColor = headerColor;
    this.rebuild();
  }

  setSelected(isSelected: boolean): void {
    if (isSelected !== this.isSelected) {
      this.isSelected = isSelected;
      this.drawBackground();
    }
  }

  setDimmed(isDimmed: boolean): void {
    this.container.alpha = isDimmed ? DIMMED_ALPHA : 1;
  }

  setContent(kind: CardContent): void {
    if (kind === this.contentKind) {
      return;
    }
    const wasSolid = isSolid(this.contentKind);
    this.releaseContent();
    this.contentKind = kind;
    if (kind !== 'none' && kind !== 'frame') {
      this.content = this.buildContent(kind);
      this.container.addChild(this.content);
    }
    if (isSolid(kind) !== wasSolid) {
      this.drawBackground();
    }
  }

  /** Creates the texts again, with the fonts of the current zoom. */
  refreshFonts(): void {
    if (this.content !== null) {
      this.content.destroy({ children: true });
      this.content = this.buildContent(this.contentKind);
      this.container.addChild(this.content);
    }
  }

  /** The member line at a vertical position inside the card, when the members are shown. */
  rowAt(localY: number): CardRow | undefined {
    if (this.contentKind !== 'members') {
      return undefined;
    }
    return this.layout.rows.find((row) => localY >= row.y && localY < row.y + CARD_STYLE.rowHeight);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private rebuild(): void {
    const kind = this.contentKind;
    this.releaseContent();
    this.drawBackground();
    this.setContent(kind);
  }

  private releaseContent(): void {
    if (this.content !== null) {
      this.content.destroy({ children: true });
      this.content = null;
    }
    this.contentKind = 'none';
  }

  /**
   * Far away, the whole card is filled with its group color ("solid"). Closer,
   * only the header band is colored and the body shows the members.
   * See glassStyle.ts for how the glass look is built.
   */
  private drawBackground(): void {
    const { width, height, separatorYs } = this.layout;
    const radius = CARD_STYLE.cornerRadius;
    const headerHeight = CARD_STYLE.headerHeight;
    const theme = this.theme;
    const color = this.headerColor;
    const graphics = this.background;
    graphics.clear();

    // A soft shadow: three larger and larger faint shapes, shifted down, fade out like a blur.
    const shadowAlpha = theme.isDark ? 0.1 : 0.04;
    for (const spread of [5, 3, 1]) {
      graphics.roundRect(-spread, 3 - spread, width + spread * 2, height + spread * 2, radius + spread).fill({ color: 0x000000, alpha: shadowAlpha });
    }
    if (this.isSelected) {
      graphics.roundRect(-3, -3, width + 6, height + 6, radius + 3).stroke({ width: 4, color: theme.accent, alpha: 0.35 });
    }

    if (isSolid(this.contentKind)) {
      graphics.roundRect(0, 0, width, height, radius).fill(verticalGradient(lighten(color, 0.22), darken(color, 0.1)));
    } else {
      const headerGradient = verticalGradient(lighten(color, 0.22), color);
      if (height <= headerHeight) {
        // A card reduced to its header. The body is not drawn under it: filling the same
        // rounded rectangle twice leaves a hairline across the card.
        graphics.roundRect(0, 0, width, height, radius).fill(headerGradient);
      } else {
        // The body lets a little of what is behind show through, like tinted glass.
        graphics.roundRect(0, 0, width, height, radius).fill({ color: theme.cardFill, alpha: 0.9 });
        // The header band: rounded corners at the top, square corners at the bottom.
        graphics
          .moveTo(0, headerHeight)
          .lineTo(0, radius)
          .quadraticCurveTo(0, 0, radius, 0)
          .lineTo(width - radius, 0)
          .quadraticCurveTo(width, 0, width, radius)
          .lineTo(width, headerHeight)
          .closePath()
          .fill(headerGradient);
      }
      const separators = separatorYs.filter((y) => y > headerHeight);
      if (separators.length > 0) {
        // beginPath starts a new path: without it, the stroke would also outline the header.
        graphics.beginPath();
        for (const y of separators) {
          graphics.moveTo(0, y).lineTo(width, y);
        }
        graphics.stroke({ width: 1, color: theme.cardBorder, alpha: 0.7 });
      }
    }

    // The bright rim just inside the border, then the border itself.
    graphics
      .roundRect(1, 1, width - 2, height - 2, radius - 1)
      .stroke({ width: 1, color: 0xffffff, alpha: theme.isDark ? 0.16 : 0.55 });
    graphics
      .roundRect(0, 0, width, height, radius)
      .stroke({ width: this.isSelected ? 2 : 1, color: this.isSelected ? theme.accent : theme.cardBorder });
  }

  private buildContent(kind: CardContent): Container {
    const content = new Container();
    if (kind === 'bigName') {
      this.addBigName(content);
    } else {
      this.addHeader(content);
      if (kind === 'members') {
        this.addRows(content);
      }
    }
    return content;
  }

  /** The class name, as large as the card allows, for the intermediate zoom level. */
  private addBigName(content: Container): void {
    const { width, height, title } = this.layout;
    const charWidthPerPixel = this.metrics.charWidth / CARD_STYLE.memberFontSize;
    const availableWidth = width - CARD_STYLE.paddingX * 2;
    const fontSize = Math.max(12, Math.min(96, availableWidth / (title.length * charWidthPerPixel), height * 0.45));
    // The size differs for every card: a pixel font per card would be needed, so the scalable font is used.
    const text = new BitmapText({ text: title, style: { fontFamily: CARD_FONTS.bold, fontSize } });
    text.tint = contrastingTextColor(this.headerColor);
    text.x = Math.max(CARD_STYLE.paddingX, (width - title.length * charWidthPerPixel * fontSize) / 2);
    text.y = (height - fontSize) / 2;
    content.addChild(text);
  }

  private addHeader(content: Container): void {
    const textColor = contrastingTextColor(this.headerColor);
    const { badge, title } = this.layout;
    if (badge !== '') {
      const badgeText = this.createText(badge, 'regular', CARD_STYLE.badgeFontSize, textColor, CARD_STYLE.paddingX, 5);
      badgeText.alpha = 0.8;
      content.addChild(badgeText);
    }
    // UML shows abstract classes in italics.
    const fontStyle = this.isAbstract ? 'italic' : 'bold';
    const titleY = badge === '' ? (CARD_STYLE.headerHeight - CARD_STYLE.titleFontSize) / 2 : 19;
    content.addChild(this.createText(title, fontStyle, CARD_STYLE.titleFontSize, textColor, CARD_STYLE.paddingX, titleY));
  }

  private addRows(content: Container): void {
    if (this.layout.rows.length === 0) {
      // No Graphics object is created for nothing: PixiJS draws stray marks for an empty one.
      return;
    }
    const icons = new Graphics();
    content.addChild(icons);
    const textX = CARD_STYLE.paddingX + CARD_STYLE.iconColumnWidth;
    const textOffsetY = (CARD_STYLE.rowHeight - CARD_STYLE.memberFontSize) / 2;
    for (const row of this.layout.rows) {
      const isMuted = row.kind === 'more' || row.kind === 'specialization';
      const fontStyle = row.isItalic ? 'italic' : 'regular';
      const color = isMuted ? this.theme.mutedText : this.theme.text;
      content.addChild(this.createText(row.text, fontStyle, CARD_STYLE.memberFontSize, color, textX, row.y + textOffsetY));
      const iconCenterY = row.y + CARD_STYLE.rowHeight / 2;
      if (row.visibility !== undefined) {
        this.drawMemberIcon(icons, row.kind === 'method', row.visibility, CARD_STYLE.paddingX + 4, iconCenterY);
      }
      if (row.isStatic) {
        // UML underlines static members.
        const underlineY = row.y + textOffsetY + CARD_STYLE.memberFontSize + 1;
        icons.moveTo(textX, underlineY).lineTo(textX + row.text.length * this.metrics.charWidth, underlineY);
        icons.stroke({ width: 1, color: this.theme.text });
      }
    }
  }

  /**
   * The icon of a member. Its shape tells what the member is: a diamond for a method, a
   * circle for an attribute. Its color tells the visibility: public, protected or private.
   */
  private drawMemberIcon(graphics: Graphics, isMethod: boolean, visibility: Visibility, x: number, y: number): void {
    const color = this.theme.visibilityColors[visibility];
    if (isMethod) {
      const size = MEMBER_ICON_SIZE + 0.8;
      graphics.poly([x, y - size, x + size, y, x, y + size, x - size, y]).fill(color);
    } else {
      graphics.circle(x, y, MEMBER_ICON_SIZE).fill(color);
    }
  }

  /** A text at (x, y) in the card, moved to the nearest whole pixel of the screen. */
  private createText(text: string, fontStyle: CardFontStyle, fontSize: number, color: number, x: number, y: number): BitmapText {
    const fontFamily = this.fonts.fontFor(fontStyle, fontSize, text);
    const bitmapText = new BitmapText({ text, style: { fontFamily, fontSize } });
    bitmapText.tint = color;
    bitmapText.position.set(this.fonts.snap(x), this.fonts.snap(y));
    return bitmapText;
  }
}

function isSolid(kind: CardContent): boolean {
  return kind === 'none' || kind === 'bigName';
}
