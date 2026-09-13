/* Audio-cue TTS glue. Verify ducking against Spotify on the Nothing Phone
 * before building guided workouts (PLAN 8a gate); the plugin docs are
 * silent on it. */

import { TextToSpeech } from "@capacitor-community/text-to-speech";

export async function speakCue(text: string): Promise<void> {
  try {
    await TextToSpeech.speak({ text, rate: 1.0 });
  } catch {
    // Cues are best-effort; the visual cue on the Live screen remains.
  }
}

export async function stopCues(): Promise<void> {
  try {
    await TextToSpeech.stop();
  } catch {
    // ignore
  }
}
