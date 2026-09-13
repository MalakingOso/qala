// Stub for liftosaur `src/migrations/migrations.ts` (`getLatestMigrationVersion`
// answers from the app's migration list). Only the program-export path needs
// it; that path is app-side, so this throws instead of inventing a version.

export function getLatestMigrationVersion(): string {
  throw new Error(
    "getLatestMigrationVersion is app-side (storage migrations) and is not available in @qala/liftoscript.",
  );
}
