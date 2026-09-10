import { useState } from 'react';
import { applyTheme, readThemePreference, writeThemePreference, type Theme } from '../lib/theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readThemePreference());

  function toggleTheme() {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    applyTheme(nextTheme);
    writeThemePreference(nextTheme);
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle-button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
