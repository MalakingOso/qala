// Running helper programs (ffmpeg, pdftotext, pdfinfo, the MinerU adapter) on
// bytes that came from the network, and limiting how many run at once.
//
// Every call is an argument array, never a shell string, with a scrubbed
// environment, a timeout, and a cap on how much stdout is kept. The routes
// take a CommandRunner so tests can pass a fake.

export interface CommandSpec {
  cmd: string;
  args: string[];
  /** Bytes written to stdin, then closed. */
  stdin?: Uint8Array;
  timeoutMs: number;
  /** Past this many bytes of stdout the process is killed and `truncated` set. */
  maxStdoutBytes?: number;
  /** Replaces the default scrubbed environment. */
  env?: Record<string, string>;
  /**
   * Start the process in its own session (setsid) and signal the whole group
   * on timeout, for programs that fork workers.
   */
  ownSession?: boolean;
}

export interface CommandResult {
  /** Exit code, or null when the process was killed. */
  code: number | null;
  stdout: Uint8Array;
  /** The last 2 KB of stderr, for error messages. */
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** The program could not be started (missing binary, no permission). */
  spawnFailed: boolean;
}

export type CommandRunner = (spec: CommandSpec) => Promise<CommandResult>;

const STDERR_KEEP = 2048;
const KILL_GRACE_MS = 3000;
const PIPE_DRAIN_MS = 2000;

export function scrubbedEnv(): Record<string, string> {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    LANG: "C.UTF-8",
  };
}

interface Drain {
  done: Promise<void>;
  cancel: () => void;
  bytes: () => Uint8Array;
  overflowed: () => boolean;
}

/** Read a stream into memory up to `cap` bytes, stopping early past it. */
function drain(
  stream: ReadableStream<Uint8Array>,
  cap: number,
  onOverflow: () => void,
): Drain {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let over = false;
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        total += value.length;
        if (total > cap) {
          over = true;
          onOverflow();
          break;
        }
        parts.push(value);
      }
    } catch {
      // A cancelled or broken pipe ends the read.
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
    }
  })();
  return {
    done,
    cancel: () => {
      reader.cancel().catch(() => {});
    },
    bytes: () => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    },
    overflowed: () => over,
  };
}

function failed(message: string): CommandResult {
  return {
    code: null,
    stdout: new Uint8Array(0),
    stderr: message,
    timedOut: false,
    truncated: false,
    spawnFailed: true,
  };
}

/** The real runner: Bun.spawn. Never throws. */
export const runCommand: CommandRunner = async (spec) => {
  const program = spec.ownSession ? "setsid" : spec.cmd;
  const args = spec.ownSession ? [spec.cmd, ...spec.args] : spec.args;
  let child: Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn([program, ...args], {
      stdin: spec.stdin ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: spec.env ?? scrubbedEnv(),
    });
  } catch (err) {
    return failed(
      `cannot run ${spec.cmd}: ${err instanceof Error ? err.message : err}`,
    );
  }

  const signal = (sig: NodeJS.Signals) => {
    try {
      // With setsid the child leads a new group, so -pid reaches its workers.
      process.kill(spec.ownSession ? -child.pid : child.pid, sig);
    } catch {
      // Already gone.
    }
  };
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    signal("SIGTERM");
    killTimer = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
  }, spec.timeoutMs);

  const out = drain(
    child.stdout,
    spec.maxStdoutBytes ?? 8 * 1024 * 1024,
    () => signal("SIGKILL"),
  );
  const err = drain(child.stderr, 64 * 1024, () => {});

  if (spec.stdin) {
    try {
      child.stdin!.write(spec.stdin);
      await child.stdin!.end();
    } catch {
      // The program exited before reading everything. Its exit code says why.
    }
  }

  const code = await child.exited;
  clearTimeout(timer);
  if (killTimer !== undefined) clearTimeout(killTimer);
  // A forked worker can keep the pipes open after the parent exits. Give the
  // readers a moment, then cut them loose and end the group.
  await Promise.race([
    Promise.all([out.done, err.done]),
    new Promise((r) => setTimeout(r, PIPE_DRAIN_MS)),
  ]);
  if (spec.ownSession) signal("SIGKILL");
  out.cancel();
  err.cancel();

  const stderrBytes = err.bytes();
  const tail = stderrBytes.slice(Math.max(0, stderrBytes.length - STDERR_KEEP));
  return {
    code: timedOut || out.overflowed() ? null : code,
    stdout: out.bytes(),
    stderr: new TextDecoder().decode(tail).trim(),
    timedOut,
    truncated: out.overflowed(),
    spawnFailed: false,
  };
};

export interface Gate {
  /** A release function, or null when `max` runs are already in flight. */
  tryEnter(): (() => void) | null;
}

/** Counting gate so a flood of uploads cannot start unbounded helper runs. */
export function createGate(max: number): Gate {
  let active = 0;
  return {
    tryEnter() {
      if (active >= max) return null;
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
        }
      };
    },
  };
}

export interface KeyedGate {
  /** A release function, or null when `key` already has its limit in flight. */
  tryEnter(key: string): (() => void) | null;
}

/** Counting gate per key, e.g. one slot per user identity. */
export function createKeyedGate(maxPerKey = 1): KeyedGate {
  const active = new Map<string, number>();
  return {
    tryEnter(key) {
      const n = active.get(key) ?? 0;
      if (n >= maxPerKey) return null;
      active.set(key, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (active.get(key) ?? 1) - 1;
        if (left <= 0) active.delete(key);
        else active.set(key, left);
      };
    },
  };
}
