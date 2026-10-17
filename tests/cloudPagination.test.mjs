import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { parseInventory } from "../src/inventory.ts";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/cloud.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;

function harness({ failOffset = -1, switchAccount = false } = {}) {
  const calls = [];
  let owner = "account-a";
  const ingredients = [
    { id: "flour", name: "Flour", unit: "kg", threshold: 2 },
  ];
  const batches = Array.from({ length: 401 }, (_, n) => ({
    id: `batch-${n}`,
    ingredientId: "flour",
    code: `B-${n}`,
    quantity: 10,
    received: "2026-01-01",
    expiry: "2027-01-01",
  }));
  const movements = Array.from({ length: 1205 }, (_, n) => ({
    id: `movement-${n}`,
    ingredientId: "flour",
    batchId: `batch-${n % 401}`,
    batch: `B-${n % 401}`,
    quantity: 10,
    type: "received",
    date: "2026-01-01T08:00:00Z",
  }));
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: owner } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: owner } } } }),
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (switchAccount) owner = "account-b";
      if (name === "inventory_command_paged") return { data: {}, error: null };
      if (name === "inventory_page") {
        if (args.p_offset === failOffset)
          return { data: null, error: { message: "Connection lost" } };
        return {
          data: {
            ingredients: ingredients.slice(
              args.p_offset,
              args.p_offset + args.p_limit,
            ),
            batches: batches.slice(args.p_offset, args.p_offset + args.p_limit),
          },
          error: null,
        };
      }
      assert.equal(name, "inventory_history_page");
      return {
        data: movements.slice(args.p_offset, args.p_offset + args.p_limit),
        error: null,
      };
    },
  };
  const modules = {
    "react-native-url-polyfill/auto": {},
    "@supabase/supabase-js": { createClient: () => client },
    "expo-sqlite/kv-store": {},
    "./inventory": { parseInventory },
  };
  const context = vm.createContext({
    exports: {},
    process: {
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        EXPO_PUBLIC_SUPABASE_KEY: "test",
      },
    },
    require: (name) => {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  vm.runInContext(compiled, context);
  return { api: context.exports, calls };
}

test("normal refresh uses bounded metadata requests and only one recent history page", async () => {
  const { api, calls } = harness();
  const result = await api.readInventory();
  assert.equal(result.ingredients.length, 1);
  assert.equal(result.batches.length, 401);
  assert.equal(result.movements.length, 25);
  assert.deepEqual(
    calls
      .filter((c) => c.name === "inventory_page")
      .map((c) => c.args.p_offset),
    [0, 200, 400],
  );
  assert.equal(
    calls.filter((c) => c.name === "inventory_history_page").length,
    1,
  );
  assert.ok(calls.every((c) => c.args.p_limit <= 200));
});

test("report export reads all history in bounded pages without truncation or duplicates", async () => {
  const { api, calls } = harness();
  const result = await api.readInventory(true);
  assert.equal(result.movements.length, 1205);
  assert.equal(new Set(result.movements.map((m) => m.id)).size, 1205);
  assert.deepEqual(
    calls
      .filter((c) => c.name === "inventory_history_page")
      .map((c) => c.args.p_offset),
    [0, 200, 400, 600, 800, 1000, 1200],
  );
});

test("history passes search, sort and inclusive local date bounds to the server", async () => {
  const { api, calls } = harness();
  await api.readHistoryPage({
    page: 3,
    search: "Flour",
    from: "2026-10-01",
    to: "2026-10-17",
    oldest: true,
  });
  const { args } = calls[0];
  assert.equal(args.p_offset, 75);
  assert.equal(args.p_limit, 26);
  assert.equal(args.p_search, "Flour");
  assert.equal(args.p_oldest, true);
  assert.equal(args.p_from, new Date("2026-10-01T00:00:00").toISOString());
  assert.equal(args.p_to, new Date("2026-10-18T00:00:00").toISOString());
});

test("failed metadata pages do not produce an incomplete inventory", async () => {
  const { api } = harness({ failOffset: 200 });
  await assert.rejects(api.readInventory(), /Connection lost/);
});

test("account switches abort paginated inventory reads", async () => {
  const { api } = harness({ switchAccount: true });
  await assert.rejects(api.readInventory(), /Account changed/);
});

test("stock edits use the lightweight command response before refreshing bounded data", async () => {
  const { api, calls } = harness();
  const result = await api.executeCommand({
    id: "request-1",
    kind: "ingredient",
    data: {},
  });
  assert.equal(calls[0].name, "inventory_command_paged");
  assert.equal(result.movements.length, 25);
  assert.ok(
    !calls.some(
      (c) => c.name === "inventory_read" || c.name === "inventory_command",
    ),
  );
});
