// Inline SVG icon set (24px grid, 1.8 stroke, round caps) + circular flags. Static markup only.
const S = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICONS = {
  back: S('<path d="M15 5l-7 7 7 7"/>'),
  chev: S('<path d="M9 5l7 7-7 7"/>'),
  undo: S('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  cards: S('<rect x="3" y="6" width="13" height="15" rx="2.5"/><path d="M8 3h10.5A2.5 2.5 0 0121 5.5V17"/>'),
  listen: S('<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3" y="14" width="4.5" height="7" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="7" rx="1.8"/>'),
  write: S('<path d="M15.5 4.5l4 4L9 19H5v-4L15.5 4.5z"/><path d="M13 7l4 4"/>'),
  stats: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
  noun: S('<path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9L12 3z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>'),
  verb: S('<path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12L13 2z"/>'),
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/></svg>',
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  again: S('<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: S('<path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/>'),
  auto: S('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  download: S('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  refresh: S('<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};
export const FLAGS = {
  fr: '<svg viewBox="0 0 3 3" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="1" height="3" fill="#0055a4"/><rect x="1" width="1" height="3" fill="#fff"/><rect x="2" width="1" height="3" fill="#ef4135"/></svg>',
  ru: '<svg viewBox="0 0 3 3" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="3" height="1" fill="#fff"/><rect y="1" width="3" height="1" fill="#0039a6"/><rect y="2" width="3" height="1" fill="#d52b1e"/></svg>',
};
export function icon(name, cls = 'i') {
  const s = document.createElement('span'); s.className = cls; s.innerHTML = ICONS[name] || FLAGS[name] || ''; return s;
}
