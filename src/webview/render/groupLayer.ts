// Draws the group boxes, the collapsed groups and the group titles (spec §4.4).
//
// Group titles keep a constant size on screen, so that the names of the
// groups stay readable when the whole diagram is seen from far away
// (spec §4.3, overview level). A title is never wider than its group box.

import { BitmapText, Container, Graphics } from 'pixi.js';
import { CARD_STYLE, FontMetrics } from '../model/cardGeometry';
import { GroupBox } from '../model/sceneGeometry';
import { CARD_FONTS } from './fonts';
import { Theme, contrastingTextColor, groupColor } from './theme';

const TITLE_FONT_SIZE = 15;
const TITLE_SCREEN_PIXELS = 15;

interface GroupTitle {
  container: Container;
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

  constructor(private readonly metrics: FontMetrics) {
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
        const { x, y, width, height } = box.rect;
        this.boxGraphics
          .roundRect(x, y, width, height, 10)
          .fill({ color: theme.groupFill, alpha: 0.6 })
          .stroke({ width: 1.5, color: groupColor(theme, box.key), alpha: 0.9 });
      }
      this.addTitle(box, theme);
    }
  }

  /** Keeps the titles at a constant size on screen. Called when the zoom changes. */
  updateTitleScale(cameraScale: number): void {
    for (const title of this.titles) {
      const rect = title.box.isCollapsed ? title.box.collapsedRect : title.box.rect;
      const wantedScale = TITLE_SCREEN_PIXELS / TITLE_FONT_SIZE / cameraScale;
      const maxScale = (rect.width - 16) / Math.max(1, title.textWidth);
      const scale = Math.max(0.01, Math.min(wantedScale, maxScale));
      title.container.scale.set(scale);
      title.container.position.set(rect.x + 8, rect.y + 6);
    }
  }

  private drawCollapsedGroup(box: GroupBox, theme: Theme): void {
    const { x, y, width, height } = box.collapsedRect;
    const color = groupColor(theme, box.key);
    this.collapsedGraphics
      .roundRect(x, y, width, height, CARD_STYLE.cornerRadius)
      .fill(color)
      .stroke({ width: 2, color: theme.cardBorder });
    // A second, offset frame suggests a stack of cards.
    this.collapsedGraphics.roundRect(x + 5, y + 5, width, height, CARD_STYLE.cornerRadius).stroke({ width: 1, color, alpha: 0.7 });
    const countText = new BitmapText({
      text: `${box.memberIds.length} classes`,
      style: { fontFamily: CARD_FONTS.regular, fontSize: 13 },
    });
    countText.tint = contrastingTextColor(color);
    countText.position.set(x + 10, y + height - 22);
    this.collapsedContainer.addChild(countText);
  }

  private addTitle(box: GroupBox, theme: Theme): void {
    const container = new Container();
    const text = new BitmapText({ text: box.label, style: { fontFamily: CARD_FONTS.bold, fontSize: TITLE_FONT_SIZE } });
    text.tint = theme.groupTitle;
    const textWidth = box.label.length * this.metrics.charWidth * (TITLE_FONT_SIZE / CARD_STYLE.memberFontSize);
    // A rounded background behind the text keeps it readable over the cards.
    const background = new Graphics()
      .roundRect(-6, -3, textWidth + 12, TITLE_FONT_SIZE + 8, 4)
      .fill({ color: theme.background, alpha: 0.85 });
    container.addChild(background, text);
    this.titleContainer.addChild(container);
    this.titles.push({ container, box, textWidth });
  }
}
