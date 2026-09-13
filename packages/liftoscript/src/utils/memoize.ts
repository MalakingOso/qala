/** Minimal memoize helper covering the `micro-memoize` subset liftosaur uses
 * (`maxSize` LRU cap plus optional per-argument `isEqual`).
 *
 * Vendored call sites keep their shape; only the import source changed so this
 * package does not pull the `micro-memoize` npm dependency.
 */

// deno-lint-ignore no-explicit-any
export type AnyFn = (...args: any[]) => unknown;

export interface MemoizeOptions {
  maxSize?: number;
  // deno-lint-ignore no-explicit-any
  isEqual?: (a: any, b: any) => boolean;
}

export default function memoize<T extends AnyFn>(
  fn: T,
  options?: MemoizeOptions,
): T {
  const maxSize = options?.maxSize ?? 1;
  const isEqual = options?.isEqual ?? ((a: unknown, b: unknown) => a === b);
  const cache: { args: unknown[]; result: unknown }[] = [];
  const wrapped = (...args: unknown[]): unknown => {
    for (let i = 0; i < cache.length; i++) {
      const entry = cache[i];
      if (
        entry.args.length === args.length &&
        entry.args.every((a, j) => isEqual(a, args[j]))
      ) {
        cache.splice(i, 1);
        cache.unshift(entry);
        return entry.result;
      }
    }
    const result = fn(...args);
    cache.unshift({ args, result });
    while (cache.length > maxSize) {
      cache.pop();
    }
    return result;
  };
  return wrapped as T;
}
