// Draws the group boxes, the collapsed groups and the group titles (spec §4.4).
//
// Group titles keep a constant size on screen, so that the names of the
// groups stay readable when the whole diagram is seen from far away
// (spec §4.3, overview level). A title is never wider than its group box.
//
// As a title has a constant size on screen, it uses a font drawn for that
// size and is placed on whole pixels, which keeps it sharp (see pixelFonts.ts).

import { BitmapText, Container, Graphics } from 'pixi.js';
import { CARD_STYLE, FontMetrics } from '../model/cardGeometry';
import { GroupBox } from '../model/sceneGeometry';
import { CARD_FONTS } from './fonts';
import { darken, lighten, verticalGradient } from './glassStyle';
import { PixelFonts } from './pixelFonts';
import { Theme, contrastingTextColor, groupColor } from './theme';

const GROUP_RADIUS = 24;
const TITLE_FONT_SIZE = 15;
const TITLE_SCREEN_PIXELS = 15;
const COUNT_FONT_SIZE = 13;

interface GroupTitle {
  container: Container;
  text: BitmapText;
  box: GroupBox;
  textWidth: number;
}

export class GroupLayer {
  /** Drawn below the edges and the cards. */
  readonly boxContainer = new Container();
  /** Drawn above the edges: collapsed groups look like cards. */
  readonly collapsedContainer = new Container();
  /** Drawn above everything, so that titles stay readable over the cards. */
  readonly titleContainer = new Container();
  private readonly boxGraphics = new Graphics();
  private readonly collapsedGraphics = new Graphics();
  private titles: GroupTitle[] = [];

  constructor(
    private readonly metrics: FontMetrics,
    private readonly fonts: PixelFonts,
  ) {
    this.boxContainer.addChild(this.boxGraphics);
    this.collapsedContainer.addChild(this.collapsedGraphics);
  }

  sync(groupBoxes: Map<string, GroupBox>, theme: Theme): void {
    this.boxGraphics.clear();
    this.collapsedGraphics.clear();
    this.titleContainer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.titles = [];

    for (const box of groupBoxes.values()) {
      if (box.isCollapsed) {
        this.drawCollapsedGroup(box, theme);
      } else {
        // A pane of glass tinted with the group color, with a bright rim inside its border.
        const { x, y, width, height } = box.rect;
        const color = groupColor(theme, box.key);
        this.boxGraphics.roundRect(x, y, width, height, GROUP_RADIUS).fill({ color: theme.groupFill, alpha: 0.42 });
        this.boxGraphics.roundRect(x, y, width, height, GROUP_RADIUS).fill({ color, alpha: 0.07 });
        this.boxGraphics
          .roundRect(x + 1.5, y + 1.5, width - 3, height - 3, GROUP_RADIUS - 1.5)
          .stroke({ width: 1, color: 0xffffff, alpha: theme.isDark ? 0.07 : 0.5 });
        this.boxGraphics.roundRect(x, y, width, height, GROUP_RADIUS).stroke({ width: 1.5, color, alpha: 0.6 });
      }
      this.addTitle(box, theme);
    }
  }

  /** Keeps the titles at a constant size on screen. Called when the zoom changes. */
  updateTitleScale(cameraScale: number): void {
    const pixelsPerUnit = cameraScale * this.fonts.pixelRatio;
    const toWholePixel = (worldCoordinate: number) => Math.round(worldCoordinate * pixelsPerUnit) / pixelsPerUnit;
    for (const title of this.titles) {
      const rect = title.box.isCollapsed ? title.box.collapsedRect : title.box.rect;
      const wantedScale = TITLE_SCREEN_PIXELS / TITLE_FONT_SIZE / cameraScale;
      const maxScale = (rect.width - 48) / Math.max(1, title.textWidth);
      const scale = Math.max(0.01, Math.min(wantedScale, maxScale));
      title.container.scale.set(scale);
      title.container.position.set(toWholePixel(rect.x + 16), toWholePixel(rect.y + 10));
      // A title shrunk to fit in its box has no fixed size on screen: it uses the scalable font.
      const hasWantedSize = scale === wantedScale;
      const fontFamily = hasWantedSize ? this.fonts.fontForScreenSize('bold', TITLE_SCREEN_PIXELS, title.box.label) : CARD_FONTS.bold;
      if (title.text.style.fontFamily !== fontFamily) {
        title.text.style.fontFamily = fontFamily;
      }
    }
  }

  private drawCollapsedGroup(box: GroupBox, theme: Theme): void {
    const { x, y, width, height } = box.collapsedRect;
    const color = groupColor(theme, box.key);
    const radius = CARD_STYLE.cornerRadius;
    // Two offset frames behind the card suggest a stack of cards.
    this.collapsedGraphics.roundRect(x + 10, y + 10, width, height, radius).fill({ color, alpha: 0.25 });
    this.collapsedGraphics.roundRect(x + 5, y + 5, width, height, radius).fill({ color, alpha: 0.45 });
    this.collapsedGraphics.roundRect(x, y, width, height, radius).fill(verticalGradient(lighten(color, 0.22), darken(color, 0.1)));
    this.collapsedGraphics
      .roundRect(x + 1, y + 1, width - 2, height - 2, radius - 1)
      .stroke({ width: 1, color: 0xffffff, alpha: theme.isDark ? 0.16 : 0.55 });
    this.collapsedGraphics.roundRect(x, y, width, height, radius).stroke({ width: 1, color: theme.cardBorder });
    const count = `${box.memberIds.length} classes`;
    const countText = new BitmapText({
      text: count,
      style: { fontFamily: this.fonts.fontFor('regular', COUNT_FONT_SIZE, count), fontSize: COUNT_FONT_SIZE },
    });
    countText.tint = contrastingTextColor(color);
    countText.position.set(this.fonts.snap(x + 10), this.fonts.snap(y + height - 22));
    this.collapsedContainer.addChild(countText);
  }

  private addTitle(box: GroupBox, theme: Theme): void {
    const container = new Container();
    const text = new BitmapText({ text: box.label, style: { fontFamily: CARD_FONTS.bold, fontSize: TITLE_FONT_SIZE } });
    text.tint = theme.groupTitle;
    const textWidth = box.label.length * this.metrics.charWidth * (TITLE_FONT_SIZE / CARD_STYLE.memberFontSize);
    // A rounded background behind the text keeps it readable over the cards.
    const background = new Graphics()
      .roundRect(-8, -4, textWidth + 16, TITLE_FONT_SIZE + 10, (TITLE_FONT_SIZE + 10) / 2)
      .fill({ color: theme.background, alpha: 0.7 })
      .stroke({ width: 1, color: groupColor(theme, box.key), alpha: 0.5 });
    container.addChild(background, text);
    this.titleContainer.addChild(container);
    this.titles.push({ container, text, box, textWidth });
  }
}
