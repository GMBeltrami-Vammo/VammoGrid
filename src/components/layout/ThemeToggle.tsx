'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

const THEME_KEY = 'vammogrid:theme';

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Read the state the anti-FOUC script already applied to <html>
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      /* private mode — keep in-memory only */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Alternar tema"
      className="flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-sm font-medium text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {mounted && isDark ? (
        <>
          <Sun className="h-4 w-4" />
          Modo claro
        </>
      ) : (
        <>
          <Moon className="h-4 w-4" />
          Modo escuro
        </>
      )}
    </button>
  );
}
