// The icons of the user interface, drawn as inline SVG.
//
// Each icon is one SVG path on a 24 x 24 grid, drawn with a stroke in the
// current text color, so icons follow the theme and the state of their button.
// Keeping them here avoids loading an icon font in the webview.

const ICON_PATHS = {
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  sidebar: 'M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M9 4v16',
  search: 'M11 5a6 6 0 1 0 0 12a6 6 0 0 0 0-12z M20 20l-4.5-4.5',
  close: 'M6 6l12 12 M18 6L6 18',
  rescan: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  export: 'M12 15V4 M8 8l4-4 4 4 M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
  grouped: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  hierarchy: 'M9 3h6v4H9z M3 17h6v4H3z M15 17h6v4h-6z M12 7v5 M6 17v-5h12v5',
  organic:
    'M6 8a2 2 0 1 0 0-4a2 2 0 0 0 0 4z M18 10a2 2 0 1 0 0-4a2 2 0 0 0 0 4z M10 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4z M8 6.4l8 1.3 M6.7 7.9l2.7 8.2 M11.2 16.4l5.6-6.8',
  relayout: 'M4 12a8 8 0 0 1 14-5.3L20 9 M20 4v5h-5 M20 12a8 8 0 0 1-14 5.3L4 15 M4 20v-5h5',
  fit: 'M4 9V5a1 1 0 0 1 1-1h4 M15 4h4a1 1 0 0 1 1 1v4 M20 15v4a1 1 0 0 1-1 1h-4 M9 20H5a1 1 0 0 1-1-1v-4',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  isolate: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M12 2v4 M12 18v4 M2 12h4 M18 12h4',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  archive: 'M4 4h16v4H4z M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8 M10 12h4',
  auto: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z',
  compact: 'M4 9h16v6H4z',
  full: 'M4 4h16v16H4z M4 9h16 M8 13h8 M8 16.5h6',
  report: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v5h5 M9 13h6 M9 17h6',
  collapse: 'M4 6h16v12H4z M9 12h6',
};

export type IconName = keyof typeof ICON_PATHS;

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
