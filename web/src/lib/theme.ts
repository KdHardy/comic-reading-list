export type Theme = 'light' | 'dark';

const THEME_KEY = 'comic-reading-list:theme';

export function readThemePreference(): Theme {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function writeThemePreference(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
