// Draws one class card with PixiJS (spec §4.2, §4.3).
//
// A card is a container holding a background (a Graphics object: rounded
// rectangle, colored header band, separators) and, when it is close enough
// to read, a "content" container with the text. The content is created only
// when the card becomes visible at a level that shows text, and destroyed as
// soon as it leaves the screen: text objects only exist for the few dozen
// cards on screen, never for the whole diagram.

import { BitmapText, Container, Graphics } from 'pixi.js';
import { Visibility } from '../../shared/graphModel';
import { CARD_STYLE, CardLayout, CardRow, FontMetrics } from '../model/cardGeometry';
import { CARD_FONTS } from './fonts';
import { CardContent } from './levelOfDetail';
import { Theme, contrastingTextColor } from './theme';

const DIMMED_ALPHA = 0.25;

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
    if (kind !== 'none') {
      this.content = this.buildContent(kind);
      this.container.addChild(this.content);
    }
    if (isSolid(kind) !== wasSolid) {
      this.drawBackground();
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
   */
  private drawBackground(): void {
    const { width, height, separatorYs } = this.layout;
    const radius = CARD_STYLE.cornerRadius;
    const headerHeight = CARD_STYLE.headerHeight;
    const graphics = this.background;
    graphics.clear();
    if (isSolid(this.contentKind)) {
      graphics.roundRect(0, 0, width, height, radius).fill(this.headerColor);
    } else {
      graphics.roundRect(0, 0, width, height, radius).fill(this.theme.cardFill);
      graphics.roundRect(0, 0, width, Math.min(height, headerHeight), radius).fill(this.headerColor);
      if (height > headerHeight) {
        // Squares the bottom corners of the header band.
        graphics.rect(0, headerHeight - radius, width, radius).fill(this.headerColor);
      }
      for (const y of separatorYs) {
        if (y > headerHeight) {
          graphics.moveTo(0, y).lineTo(width, y);
        }
      }
      graphics.stroke({ width: 1, color: this.theme.cardBorder });
    }
    graphics
      .roundRect(0, 0, width, height, radius)
      .stroke({ width: this.isSelected ? 3 : 1, color: this.isSelected ? this.theme.accent : this.theme.cardBorder });
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
    const text = this.createText(title, CARD_FONTS.bold, fontSize, contrastingTextColor(this.headerColor));
    text.x = Math.max(CARD_STYLE.paddingX, (width - title.length * charWidthPerPixel * fontSize) / 2);
    text.y = (height - fontSize) / 2;
    content.addChild(text);
  }

  private addHeader(content: Container): void {
    const textColor = contrastingTextColor(this.headerColor);
    const { badge, title } = this.layout;
    if (badge !== '') {
      const badgeText = this.createText(badge, CARD_FONTS.regular, CARD_STYLE.badgeFontSize, textColor);
      badgeText.alpha = 0.8;
      badgeText.position.set(CARD_STYLE.paddingX, 5);
      content.addChild(badgeText);
    }
    // UML shows abstract classes in italics.
    const font = this.isAbstract ? CARD_FONTS.italic : CARD_FONTS.bold;
    const titleText = this.createText(title, font, CARD_STYLE.titleFontSize, textColor);
    titleText.position.set(CARD_STYLE.paddingX, badge === '' ? (CARD_STYLE.headerHeight - CARD_STYLE.titleFontSize) / 2 : 19);
    content.addChild(titleText);
  }

  private addRows(content: Container): void {
    const icons = new Graphics();
    content.addChild(icons);
    const textX = CARD_STYLE.paddingX + CARD_STYLE.iconColumnWidth;
    const textOffsetY = (CARD_STYLE.rowHeight - CARD_STYLE.memberFontSize) / 2;
    for (const row of this.layout.rows) {
      const isMuted = row.kind === 'more' || row.kind === 'specialization';
      const font = row.isItalic ? CARD_FONTS.italic : CARD_FONTS.regular;
      const text = this.createText(row.text, font, CARD_STYLE.memberFontSize, isMuted ? this.theme.mutedText : this.theme.text);
      text.position.set(textX, row.y + textOffsetY);
      content.addChild(text);
      const iconCenterY = row.y + CARD_STYLE.rowHeight / 2;
      if (row.visibility !== undefined) {
        this.drawVisibilityIcon(icons, row.visibility, CARD_STYLE.paddingX + 4, iconCenterY);
      }
      if (row.isStatic) {
        // UML underlines static members.
        const underlineY = row.y + textOffsetY + CARD_STYLE.memberFontSize + 1;
        icons.moveTo(textX, underlineY).lineTo(textX + row.text.length * this.metrics.charWidth, underlineY);
        icons.stroke({ width: 1, color: this.theme.text });
      }
    }
  }

  /** Public: circle, protected: diamond, private: square, each in its own color. */
  private drawVisibilityIcon(graphics: Graphics, visibility: Visibility, x: number, y: number): void {
    const color = this.theme.visibilityColors[visibility];
    const size = 3.5;
    if (visibility === 'public') {
      graphics.circle(x, y, size).fill(color);
    } else if (visibility === 'protected') {
      graphics.poly([x, y - size - 0.5, x + size + 0.5, y, x, y + size + 0.5, x - size - 0.5, y]).fill(color);
    } else {
      graphics.rect(x - size, y - size, size * 2, size * 2).fill(color);
    }
  }

  private createText(text: string, fontName: string, fontSize: number, color: number): BitmapText {
    const bitmapText = new BitmapText({ text, style: { fontFamily: fontName, fontSize } });
    bitmapText.tint = color;
    return bitmapText;
  }
}

function isSolid(kind: CardContent): boolean {
  return kind === 'none' || kind === 'bigName';
}
