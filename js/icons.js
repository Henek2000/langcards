// Inline SVG icons (24px grid, 2.6 stroke, square caps and mitred joins). Static markup only.
const S = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`;
export const ICONS = {
  back: S('<path d="M20 12H5M11 5l-7 7 7 7"/>'),
  arrow: S('<path d="M4 12h15M13 5l7 7-7 7"/>'),
  undo: S('<path d="M9 15L3 9l6-6"/><path d="M3 9h12a6 6 0 010 12h-4"/>'),
  check: S('<path d="M4 12.5l5 5L20 6.5"/>'),
  x: S('<path d="M5 5l14 14M19 5L5 19"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3v18l15-9z"/></svg>',
  download: S('<path d="M12 3v12M6 10l6 6 6-6M3 21h18"/>'),
  upload: S('<path d="M12 16V4M6 9l6-6 6 6M3 21h18"/>'),
  refresh: S('<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 3v8h-8"/>'),
  trash: S('<path d="M3 6h18M10 11v6M14 11v6M5 6l1 15h12l1-15M9 6V3h6v3"/>'),
};
export function icon(name, cls = 'i') {
  const s = document.createElement('span'); s.className = cls; s.innerHTML = ICONS[name] || ''; return s;
}
