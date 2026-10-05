"use client";

import { useEffect, useSyncExternalStore } from "react";

// The light/dark switch in the header. The script in app/layout.tsx applies a stored choice before first paint;
// without one, the page follows the device setting.
export const THEME_KEY = "upcomer-theme";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : darkQuery().matches;
};

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    query.removeEventListener("change", onChange);
  };
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  // Another tab changed the choice.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      if (event.newValue === "light" || event.newValue === "dark") document.documentElement.dataset.theme = event.newValue;
      else delete document.documentElement.dataset.theme;
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage unavailable (private mode); the choice lasts for this page only.
    }
  };

  return <button type="button" className="theme-toggle" aria-label="Dark mode" aria-pressed={dark} onClick={toggle}>
    <svg className="theme-icon theme-icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <svg className="theme-icon theme-icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </g>
    </svg>
  </button>;
}
