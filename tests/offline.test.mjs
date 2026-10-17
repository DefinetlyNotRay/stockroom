import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { emptyInventory, parseInventory } from "../src/inventory.ts";
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/offline.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const ctx = vm.createContext({
  exports: {},
  require: () => ({ emptyInventory, parseInventory }),
});
vm.runInContext(compiled, ctx);
const { createOfflineStore } = ctx.exports;
const inventory = (count) => ({
  ingredients: Array.from({ length: count }, (_, n) => ({
    id: `i${n}`,
    name: `Ingredient ${n}`,
    unit: "kg",
    threshold: 0,
  })),
  batches: [],
  movements: [],
});
const command = (n) => ({
  id: `i${n}`,
  kind: "ingredient",
  data: { name: `Ingredient ${n}`, unit: "kg", threshold: 0 },
  occurredAt: "2026-10-17T08:00:00Z",
});
function storage() {
  const values = new Map();
  let fail = false;
  return {
    values,
    setFail: (v) => {
      fail = v;
    },
    getItem: async (key) => values.get(key) || null,
    setItem: async (key, value) => {
      if (fail) throw Error("Disk full");
      values.set(key, value);
    },
  };
}

test("offline entries and visible inventory survive restarts in one atomic value", async () => {
  const disk = storage();
  await createOfflineStore(disk).enqueue("a", command(0), inventory(1), 0);
  const restored = await createOfflineStore(disk).load("a");
  assert.equal(restored.pending.length, 1);
  assert.equal(restored.inventory.ingredients.length, 1);
  assert.equal(disk.values.size, 1);
  assert.equal((await createOfflineStore(disk).load("b")).pending.length, 0);
});
test("failed disk writes cannot save inventory without its queue", async () => {
  const disk = storage();
  const store = createOfflineStore(disk);
  disk.setFail(true);
  await assert.rejects(
    store.enqueue("a", command(0), inventory(1), 0),
    /Disk full/,
  );
  disk.setFail(false);
  assert.equal((await store.load("a")).inventory.ingredients.length, 0);
  assert.equal((await store.load("a")).pending.length, 0);
});
test("network failures retain the queue and local changes", async () => {
  const store = createOfflineStore(storage());
  await store.enqueue("a", command(0), inventory(1), 0);
  await assert.rejects(
    store.sync(
      "a",
      async () => {
        throw Error("Offline");
      },
      async () => inventory(0),
    ),
    /Offline/,
  );
  assert.equal((await store.load("a")).pending.length, 1);
  assert.equal((await store.load("a")).inventory.ingredients.length, 1);
});
test("retry after server commit but failed local acknowledgement uses the same ID", async () => {
  const disk = storage();
  const store = createOfflineStore(disk);
  await store.enqueue("a", command(0), inventory(1), 0);
  const serverIds = new Set();
  await assert.rejects(
    store.sync(
      "a",
      async (cmd) => {
        serverIds.add(cmd.id);
        disk.setFail(true);
      },
      async () => inventory(1),
    ),
    /Disk full/,
  );
  disk.setFail(false);
  const result = await createOfflineStore(disk).sync(
    "a",
    async (cmd) => {
      serverIds.add(cmd.id);
    },
    async () => inventory(1),
  );
  assert.equal(serverIds.size, 1);
  assert.equal(result.pending.length, 0);
});
test("saving remains possible during network sync, and dependency order is preserved", async () => {
  const store = createOfflineStore(storage());
  await store.enqueue("a", command(0), inventory(1), 0);
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sent = [];
  const sync = store.sync(
    "a",
    async (cmd) => {
      sent.push(cmd.id);
      if (cmd.id === "i0") {
        started();
        await gate;
      }
    },
    async () => inventory(2),
  );
  await ready;
  await store.enqueue("a", command(1), inventory(2), 1);
  release();
  const result = await sync;
  assert.deepEqual(sent, ["i0", "i1"]);
  assert.equal(result.pending.length, 0);
  assert.equal(result.inventory.ingredients.length, 2);
});
test("remote refresh cannot overwrite an entry saved while pages were loading", async () => {
  const store = createOfflineStore(storage());
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sync = store.sync(
    "a",
    async () => {},
    async () => {
      started();
      await gate;
      return inventory(0);
    },
  );
  await ready;
  await store.enqueue("a", command(0), inventory(1), 0);
  release();
  const result = await sync;
  assert.equal(result.inventory.ingredients.length, 1);
  assert.equal(result.pending.length, 1);
});
test("sync stops at conflicts and keeps later dependent entries", async () => {
  const store = createOfflineStore(storage());
  for (let n = 0; n < 3; n++)
    await store.enqueue("a", command(n), inventory(n + 1), n);
  const sent = [];
  await assert.rejects(
    store.sync(
      "a",
      async (cmd) => {
        sent.push(cmd.id);
        if (cmd.id === "i1") throw Error("Sync conflict");
      },
      async () => inventory(0),
    ),
    /Sync conflict/,
  );
  const result = await store.load("a");
  assert.deepEqual(sent, ["i0", "i1"]);
  assert.equal(result.pending.length, 2);
  assert.equal(result.pending[0].id, "i1");
  assert.equal(result.inventory.ingredients.length, 3);
});
test("discard requires a successful remote read before removing pending changes", async () => {
  const store = createOfflineStore(storage());
  await store.enqueue("a", command(0), inventory(1), 0);
  await assert.rejects(
    store.discardPending("a", async () => {
      throw Error("Offline");
    }),
    /Offline/,
  );
  assert.equal((await store.load("a")).pending.length, 1);
  const result = await store.discardPending("a", async () => inventory(0));
  assert.equal(result.pending.length, 0);
  assert.equal(result.inventory.ingredients.length, 0);
});
test("stale forms cannot replace a newer local inventory", async () => {
  const store = createOfflineStore(storage());
  await store.enqueue("a", command(0), inventory(1), 0);
  await assert.rejects(
    store.enqueue("a", command(1), inventory(2), 0),
    /Stock changed/,
  );
  assert.equal((await store.load("a")).pending.length, 1);
});

test("a queue acknowledgement does not reject a new entry when inventory is unchanged", async () => {
  const store = createOfflineStore(storage());
  await store.enqueue("a", command(0), inventory(1), 0);
  let started, release;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sync = store.sync(
    "a",
    async () => {},
    async () => {
      started();
      await gate;
      return inventory(1);
    },
  );
  await ready;
  const queued = await store.enqueue(
    "a",
    command(1),
    inventory(2),
    1,
    inventory(1),
  );
  assert.equal(queued.version, 3);
  release();
  const result = await sync;
  assert.equal(result.pending.length, 1);
  assert.equal(result.inventory.ingredients.length, 2);
});
