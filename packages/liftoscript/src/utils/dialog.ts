// Headless stand-in for liftosaur `src/utils/dialog.ts` (which binds
// `window.alert`/`confirm`/`prompt`). In this package alerts become console
// output; confirm/choice/prompt resolve to their dismiss values.

// deno-lint-ignore require-await
export async function Dialog_confirm(message: string): Promise<boolean> {
  console.error(`[confirm dismissed] ${message}`);
  return Promise.resolve(false);
}

// deno-lint-ignore require-await
export async function Dialog_choice(
  title: string,
  message: string,
  options: string[],
): Promise<number | undefined> {
  console.error(
    `[choice dismissed] ${title}: ${message} (${options.join(" / ")})`,
  );
  return Promise.resolve(undefined);
}

// deno-lint-ignore require-await
export async function Dialog_prompt(
  message: string,
): Promise<string | undefined> {
  console.error(`[prompt dismissed] ${message}`);
  return Promise.resolve(undefined);
}

export function Dialog_alert(message: string): void {
  console.error(`[alert] ${message}`);
}
