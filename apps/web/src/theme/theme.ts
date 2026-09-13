/* Theme + title-font application. Tokens live in theme/tokens.css,
 * faces in theme/fonts.css (DESIGN sections 2-3). */

export type Theme = "light" | "dark" | "system";
export type TitleFont = "qalaTest" | "faustina";

export function effectiveTheme(theme: Theme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = effectiveTheme(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      effectiveTheme(theme) === "dark" ? "#0b1020" : "#f5f5f7",
    );
  }
}

export function applyTitleFont(font: TitleFont): void {
  document.body.dataset.titlefont = font;
}

/** Re-apply on OS theme change while theme is 'system'. Returns cleanup. */
export function watchSystemTheme(theme: Theme): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (theme === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
