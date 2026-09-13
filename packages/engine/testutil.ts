// Shared tiny assertions (no external deps; offline-safe).

export function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

export function assertClose(
  actual: number,
  expected: number,
  tol: number,
  msg: string,
): void {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(
      `assertClose failed: ${msg}: actual=${actual} expected=${expected} tol=${tol}`,
    );
  }
}

export function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`assertEqual failed: ${msg}: actual=${a} expected=${e}`);
  }
}
