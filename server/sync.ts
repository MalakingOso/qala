// Sync storage for the Qala server (PLAN.md section 7): one automerge
// document per user, persisted under `data/users/<login>/`.
//
// The primary store is automerge-repo's `NodeFSStorageAdapter` running under
// Deno's Node compatibility layer. If that import ever fails, we fall back to
// the small `DenoFSStorageAdapter` below (pure Deno file APIs, same key
// layout contract). The two adapters are not byte-layout compatible with each
// other; a checkout uses whichever loads first and stays on it.

import { Repo } from "@automerge/automerge-repo";
import type {
  Chunk,
  DocumentId,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo";

/** Record persisted at `data/users/<login>.json` holding the user's doc id. */
export interface UserRecord {
  login: string;
  docId: string;
  createdAt: string;
}

/**
 * Filesystem storage adapter built only on Deno APIs. Fallback for when the
 * Node compat `NodeFSStorageAdapter` cannot be constructed. Keys map to
 * paths segment by segment under the base directory.
 */
export class DenoFSStorageAdapter implements StorageAdapterInterface {
  #base: string;

  constructor(baseDirectory: string) {
    this.#base = baseDirectory.replace(/\/+$/, "");
  }

  #path(key: StorageKey): string {
    const safe = key.map((part) => part.replace(/[^A-Za-z0-9._-]/g, "_"));
    return `${this.#base}/${safe.join("/")}`;
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    try {
      return await Deno.readFile(this.#path(key));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return undefined;
      throw err;
    }
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    const path = this.#path(key);
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeFile(path, data);
  }

  async remove(key: StorageKey): Promise<void> {
    try {
      await Deno.remove(this.#path(key));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const out: Chunk[] = [];
    await this.#walk(keyPrefix, this.#path(keyPrefix), out);
    return out;
  }

  async #walk(
    keyPrefix: StorageKey,
    dir: string,
    out: Chunk[],
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const key = [...keyPrefix, entry.name];
        const path = `${dir}/${entry.name}`;
        if (entry.isFile) {
          out.push({ key, data: await Deno.readFile(path) });
        } else if (entry.isDirectory) {
          await this.#walk(key, path, out);
        }
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    }
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    try {
      await Deno.remove(this.#path(keyPrefix), { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
}

/** Prefer `NodeFSStorageAdapter` under Node compat, else the Deno fallback. */
export async function createStorage(
  baseDir: string,
): Promise<StorageAdapterInterface> {
  try {
    const { NodeFSStorageAdapter } = await import(
      "@automerge/automerge-repo-storage-nodefs"
    );
    await Deno.mkdir(baseDir, { recursive: true });
    return new NodeFSStorageAdapter(baseDir);
  } catch {
    return new DenoFSStorageAdapter(baseDir);
  }
}

export function userDir(dataRoot: string, login: string): string {
  return `${dataRoot}/users/${login}`;
}

export function userRecordPath(dataRoot: string, login: string): string {
  return `${userDir(dataRoot, login)}.json`;
}

export async function readUserRecord(
  dataRoot: string,
  login: string,
): Promise<UserRecord | null> {
  try {
    const text = await Deno.readTextFile(userRecordPath(dataRoot, login));
    const parsed = JSON.parse(text) as Partial<UserRecord>;
    if (typeof parsed.docId !== "string" || parsed.docId === "") return null;
    return {
      login,
      docId: parsed.docId,
      createdAt: String(parsed.createdAt ?? ""),
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

async function writeUserRecord(
  dataRoot: string,
  record: UserRecord,
): Promise<void> {
  await Deno.mkdir(`${dataRoot}/users`, { recursive: true });
  await Deno.writeTextFile(
    userRecordPath(dataRoot, record.login),
    JSON.stringify(record, null, 2),
  );
}

/**
 * Per-user sync state: one `Repo` per user backed by storage under
 * `data/users/<login>/`, plus the `<login>.json` record holding the doc id.
 * Repos are cached so a process holds at most one per user.
 */
export class UserSyncStore {
  #repos = new Map<string, Repo>();
  /**
   * Per-login serialization so two concurrent first-use connections can't
   * both see no repo/record, both create one, and race on the write: each
   * login's setup work is chained onto the previous one instead of running
   * concurrently with it.
   */
  #locks = new Map<string, Promise<unknown>>();

  constructor(private dataRoot: string) {}

  #withLock<T>(login: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.#locks.get(login) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    this.#locks.set(login, next.then(() => undefined, () => undefined));
    return next;
  }

  async #repoForUserLocked(login: string): Promise<Repo> {
    const cached = this.#repos.get(login);
    if (cached) return cached;
    const storage = await createStorage(
      `${userDir(this.dataRoot, login)}/chunks`,
    );
    const repo = new Repo({ storage });
    this.#repos.set(login, repo);
    return repo;
  }

  repoForUser(login: string): Promise<Repo> {
    const cached = this.#repos.get(login);
    if (cached) return Promise.resolve(cached);
    return this.#withLock(login, () => this.#repoForUserLocked(login));
  }

  /**
   * The user's one document, created on first use. The returned doc id is
   * stable: later calls read it back from the `<login>.json` record.
   */
  docForUser(login: string): Promise<{ docId: string; url: string }> {
    return this.#withLock(login, async () => {
      const repo = await this.#repoForUserLocked(login);
      const record = await readUserRecord(this.dataRoot, login);
      if (record) {
        repo.find(record.docId as DocumentId);
        return { docId: record.docId, url: `automerge:${record.docId}` };
      }
      const handle = repo.create();
      const docId = handle.documentId;
      const url = handle.url;
      await writeUserRecord(this.dataRoot, {
        login,
        docId,
        createdAt: new Date().toISOString(),
      });
      return { docId, url };
    });
  }

  /** True when `docId` is the document recorded for `login`. */
  async ownsDocument(login: string, docId: string): Promise<boolean> {
    const record = await readUserRecord(this.dataRoot, login);
    return record !== null && record.docId === docId;
  }
}
