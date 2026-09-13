// Sync tests: offline merge of diverged docs, the DenoFS storage fallback,
// and per-user document allocation under data/users/.

import * as Automerge from "@automerge/automerge";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DenoFSStorageAdapter, readUserRecord, UserSyncStore } from "./sync.ts";

interface WorkoutDoc {
  workouts?: string[];
  note?: string;
}

Deno.test("two offline docs merge cleanly", () => {
  const base = Automerge.change(
    Automerge.init<WorkoutDoc>(),
    (d) => {
      d.workouts = ["monday"];
    },
  );
  const alice = Automerge.clone(base);
  const phone = Automerge.clone(base);
  // Each side edits while offline.
  const aliceNext = Automerge.change(alice, (d) => {
    d.workouts!.push("wednesday");
  });
  const phoneNext = Automerge.change(phone, (d) => {
    d.note = "felt strong";
  });
  // Exchange changes (as sync would) and merge both ways.
  const mergedA = Automerge.merge(Automerge.clone(aliceNext), phoneNext);
  const mergedB = Automerge.merge(Automerge.clone(phoneNext), aliceNext);
  assertEquals(mergedA.workouts, ["monday", "wednesday"]);
  assertEquals(mergedA.note, "felt strong");
  assertEquals(mergedB, mergedA);
});

Deno.test("offline binary changes apply across a save/load round-trip", () => {
  const doc = Automerge.change(
    Automerge.init<WorkoutDoc>(),
    (d) => {
      d.workouts = ["a"];
    },
  );
  const offline = Automerge.load<WorkoutDoc>(Automerge.save(doc));
  const edited = Automerge.change(offline, (d) => {
    d.workouts!.push("b");
  });
  const changes = Automerge.getChanges(doc, edited);
  assert(changes.length > 0);
  const synced = Automerge.applyChanges(doc, changes)[0];
  assertEquals(synced.workouts, ["a", "b"]);
});

Deno.test("DenoFSStorageAdapter round-trips keys and ranges", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qala-storage-" });
  try {
    const storage = new DenoFSStorageAdapter(dir);
    assertEquals(await storage.load(["doc1", "snapshot", "a"]), undefined);
    await storage.save(["doc1", "snapshot", "a"], new Uint8Array([1, 2, 3]));
    await storage.save(
      ["doc1", "incremental", "b"],
      new Uint8Array([4, 5]),
    );
    assertEquals(
      await storage.load(["doc1", "snapshot", "a"]),
      new Uint8Array([1, 2, 3]),
    );
    const range = await storage.loadRange(["doc1"]);
    assertEquals(range.length, 2);
    await storage.remove(["doc1", "snapshot", "a"]);
    assertEquals(await storage.load(["doc1", "snapshot", "a"]), undefined);
    await storage.removeRange(["doc1"]);
    assertEquals(await storage.loadRange(["doc1"]), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("one stable document per user under data/users/", async () => {
  const dataRoot = await Deno.makeTempDir({ prefix: "qala-data-" });
  try {
    const store = new UserSyncStore(dataRoot);
    const first = await store.docForUser("alice");
    const second = await store.docForUser("alice");
    assertEquals(second.docId, first.docId);
    assert(first.url.startsWith("automerge:"));

    const bob = await store.docForUser("bob");
    assertNotEquals(bob.docId, first.docId);

    // The record file holds the document id.
    const record = await readUserRecord(dataRoot, "alice");
    assertEquals(record?.docId, first.docId);
    const stat = await Deno.stat(`${dataRoot}/users/alice.json`);
    assert(stat.isFile);

    assert(await store.ownsDocument("alice", first.docId));
    assert(!(await store.ownsDocument("alice", bob.docId)));
    assert(!(await store.ownsDocument("mallory", first.docId)));
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("concurrent first-use for a brand-new user doesn't race into two documents", async () => {
  const dataRoot = await Deno.makeTempDir({ prefix: "qala-data-race-" });
  try {
    const store = new UserSyncStore(dataRoot);
    const [a, b, c] = await Promise.all([
      store.docForUser("newdevice"),
      store.docForUser("newdevice"),
      store.docForUser("newdevice"),
    ]);
    assertEquals(b.docId, a.docId);
    assertEquals(c.docId, a.docId);
    const record = await readUserRecord(dataRoot, "newdevice");
    assertEquals(record?.docId, a.docId);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});
