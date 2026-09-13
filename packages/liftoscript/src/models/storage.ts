// Stub for liftosaur `src/models/storage.ts` (the whole-app automerge-backed
// store with migrations). Only `PlannerProgram_getExportedPlannerProgram`
// touches it, on the program-import path. Headless import/export through the
// full store is out of scope for this package; that path throws a descriptive
// error instead of silently producing store-shaped data.

// deno-lint-ignore no-explicit-any
export function Storage_getDefault(): any {
  throw new Error(
    "Storage_getDefault is app-side (automerge store + migrations) and is not available in @qala/liftoscript.",
  );
}

// deno-lint-ignore no-explicit-any
export function Storage_get(_storage: any): any {
  throw new Error(
    "Storage_get is app-side (automerge store + migrations) and is not available in @qala/liftoscript.",
  );
}
