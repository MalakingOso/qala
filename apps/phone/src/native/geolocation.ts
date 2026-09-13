/* Background GPS recorder glue (PLAN 8a). One owner of location: fixes are
 * deduplicated by timestamp in the web pipeline; this layer only captures
 * and forwards raw fixes with their own timestamps, and keeps writing the
 * run-in-progress to the local document so a killed app loses seconds, not
 * the run. Permission order: foreground + notifications at first run start,
 * background location only when recording starts. */

import { BackgroundGeolocation, type BgFix } from "@capgo/background-geolocation";

export interface RawFix {
  t: number;
  lat: number;
  lon: number;
  acc: number;
  speed?: number;
}

export type FixHandler = (fix: RawFix) => void;

let watcherId: string | null = null;

export async function ensureRunPermissions(): Promise<boolean> {
  const res = await BackgroundGeolocation.requestPermissions();
  return res.granted;
}

export async function startRunRecording(onFix: FixHandler): Promise<void> {
  const ok = await ensureRunPermissions();
  if (!ok) throw new Error("location permission denied");
  await BackgroundGeolocation.start();
  const seen = new Set<number>();
  const watcher = await BackgroundGeolocation.addWatcher({}, (fix: BgFix | null) => {
    if (!fix || seen.has(fix.time)) return; // jara bug 1: same fix twice counts once
    seen.add(fix.time);
    onFix({ t: fix.time, lat: fix.latitude, lon: fix.longitude, acc: fix.accuracy, speed: fix.speed });
  });
  watcherId = watcher.watcherId;
}

export async function stopRunRecording(): Promise<void> {
  if (watcherId) {
    await BackgroundGeolocation.removeWatcher({ watcherId });
    watcherId = null;
  }
  await BackgroundGeolocation.stop();
}
