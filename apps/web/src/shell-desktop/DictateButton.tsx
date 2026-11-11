/* Dictation control (docs/rust-core.md section 12): record up to 30 s with
 * MediaRecorder, send the clip to POST /api/transcribe, hand the transcript
 * to the page. The import screen (ImportPanel.tsx) puts it in its text box,
 * where the owner reads and corrects it before sending it to
 * /api/import/text. */

import { useEffect, useRef, useState } from "react";
import {
  formatClock,
  MAX_DICTATION_MS,
  pickRecorderMime,
  sendClip,
  type TranscribeResult,
} from "../logic/dictation.ts";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "sending" }
  | { kind: "error"; message: string };

export function DictateButton({
  onTranscript,
}: {
  onTranscript: (text: string, result: TranscribeResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const capTimer = useRef<number | undefined>(undefined);
  const tick = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  const release = () => {
    window.clearTimeout(capTimer.current);
    window.clearInterval(tick.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const r = recorder.current;
      recorder.current = null;
      if (r && r.state !== "inactive") {
        r.onstop = null;
        r.stop();
      }
      release();
    };
  }, []);

  const stop = () => {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  };

  const start = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setPhase({ kind: "error", message: "This browser cannot record audio." });
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase({
        kind: "error",
        message:
          "Microphone access was blocked. Allow it in the browser and try again.",
      });
      return;
    }
    stream.current = media;
    const mime = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
    const rec = mime
      ? new MediaRecorder(media, { mimeType: mime })
      : new MediaRecorder(media);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = async () => {
      release();
      recorder.current = null;
      if (!mounted.current) return;
      const clip = new Blob(chunks, {
        type: rec.mimeType || mime || "audio/webm",
      });
      if (clip.size === 0) {
        setPhase({ kind: "error", message: "Nothing was recorded." });
        return;
      }
      setPhase({ kind: "sending" });
      const out = await sendClip(clip);
      if (!mounted.current) return;
      if (out.ok) {
        setPhase({ kind: "idle" });
        onTranscript(out.result.text, out.result);
      } else {
        setPhase({ kind: "error", message: out.message });
      }
    };
    recorder.current = rec;
    const startedAt = Date.now();
    setElapsed(0);
    setPhase({ kind: "recording", startedAt });
    rec.start();
    tick.current = window.setInterval(() => {
      setElapsed(Math.min(MAX_DICTATION_MS, Date.now() - startedAt));
    }, 200);
    // The server refuses anything longer than 30 s, so stop here.
    capTimer.current = window.setTimeout(stop, MAX_DICTATION_MS);
  };

  const recording = phase.kind === "recording";
  return (
    <div className="dictate">
      {recording
        ? (
          <button
            type="button"
            className="btn-secondary small dictate-stop"
            onClick={stop}
          >
            <span className="dictate-dot" aria-hidden="true" />
            Stop
          </button>
        )
        : (
          <button
            type="button"
            className="btn-secondary small"
            onClick={start}
            disabled={phase.kind === "sending"}
          >
            Dictate
          </button>
        )}
      <span
        className="dictate-status kbd-hint"
        role="status"
        aria-live="polite"
      >
        {phase.kind === "recording" &&
          `Recording ${formatClock(elapsed)} of ${
            formatClock(MAX_DICTATION_MS)
          }`}
        {phase.kind === "sending" && "Transcribing..."}
        {phase.kind === "error" && phase.message}
        {phase.kind === "idle" && "Up to 30 seconds."}
      </span>
    </div>
  );
}
