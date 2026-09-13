/* Native entry: permission flow + plugin wiring for the bundled phone
 * shell. Called once from the web shell when `Capacitor.isNativePlatform()`.
 * Web fallback stays fully usable for lifting-only PWA use (incl. iOS). */

import { Capacitor } from "@capacitor/core";
import { ensureRunPermissions } from "./geolocation";

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Request notification permission at first run start, not at install. */
export async function prepareFirstRun(): Promise<{ location: boolean }> {
  if (!isNative()) return { location: false };
  const location = await ensureRunPermissions();
  return { location };
}

export { startRunRecording, stopRunRecording } from "./geolocation";
export { speakCue, stopCues } from "./audioCues";
export { connectHrStrap, requestHrDevice } from "./hrm";
