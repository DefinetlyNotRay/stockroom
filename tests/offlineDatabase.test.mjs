import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("offline sync preserves dates, dependencies, exact allocations, retry safety and account boundaries", async () => {
  const db = new PGlite();
  const owner = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;
      insert into auth.users values('${owner}'),('${other}');`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    const { day, occurred } = (
      await db.query(
        "select (current_date-20)::text as day, (current_date-20+interval '8 hours')::text as occurred",
      )
    ).rows[0];
    await db.exec(
      `set role authenticated; set "request.jwt.claim.sub"='${owner}';`,
    );
    const send = async (id, kind, data, account = owner) =>
      (
        await db.query(
          "select inventory_sync_command($1,$2,$3,$4::jsonb,$5::timestamptz) as data",
          [
            account,
            id,
            kind,
            JSON.stringify({ today: day, ...data }),
            occurred,
          ],
        )
      ).rows[0].data;
    const read = async () =>
      (await db.query("select inventory_read() as data")).rows[0].data;
    await send("flour", "ingredient", {
      name: "Flour",
      unit: "kg",
      threshold: 2,
    });
    await send("batch-a", "receive", {
      ingredientId: "flour",
      code: "A",
      quantity: 20,
      received: day,
      expiry: "2099-01-01",
    });
    const use = {
      ingredientId: "flour",
      quantity: 6,
      batchId: null,
      allocations: [{ batchId: "batch-a", quantity: 6 }],
    };
    await send("use-a", "use", use);
    await send("use-a", "use", use);
    assert.equal((await read()).batches[0].quantity, 14);
    await assert.rejects(
      send("use-a", "use", { ...use, quantity: 7 }),
      /already used/,
    );
    const history = (await read()).movements;
    assert.equal(history.filter((m) => m.type === "used").length, 1);
    assert.ok(history.every((m) => m.date.slice(0, 10) === day));
    await assert.rejects(
      send(
        "wrong-owner",
        "ingredient",
        { name: "Wrong", unit: "kg", threshold: 0 },
        other,
      ),
      /owns these/,
    );
    await assert.rejects(
      send(
        "null-owner",
        "ingredient",
        { name: "Wrong", unit: "kg", threshold: 0 },
        null,
      ),
      /owns these/,
    );
    await assert.rejects(
      db.query("select inventory_apply_offline('bad','ingredient','{}')"),
      /permission denied/,
    );
    const before = JSON.stringify(await read());
    await assert.rejects(
      send("conflict-count", "adjust", {
        ingredientId: "flour",
        batchId: "batch-a",
        quantity: 5,
        expectedQuantity: 20,
        reason: "Offline count",
      }),
      /Sync conflict/,
    );
    await assert.rejects(
      send("conflict-min", "settings", {
        ingredientId: "flour",
        threshold: 3,
        expectedThreshold: 0,
      }),
      /Sync conflict/,
    );
    await assert.rejects(
      send("overspend", "use", {
        ...use,
        quantity: 15,
        allocations: [{ batchId: "batch-a", quantity: 15 }],
      }),
      /Sync conflict/,
    );
    assert.equal(JSON.stringify(await read()), before);
    await send("count", "adjust", {
      ingredientId: "flour",
      batchId: "batch-a",
      quantity: 12,
      expectedQuantity: 14,
      reason: "Offline count",
    });
    await send("minimum", "settings", {
      ingredientId: "flour",
      threshold: 0,
      expectedThreshold: 2,
    });
    assert.equal((await read()).batches[0].quantity, 12);
    assert.equal((await read()).ingredients[0].threshold, 0);
    await send("batch-b", "receive", {
      ingredientId: "flour",
      code: "B",
      quantity: 10,
      received: day,
      expiry: "2099-01-01",
    });
    await assert.rejects(
      send("rollback", "use", {
        ingredientId: "flour",
        quantity: 30,
        allocations: [
          { batchId: "batch-a", quantity: 5 },
          { batchId: "batch-b", quantity: 25 },
        ],
      }),
      /Sync conflict/,
    );
    assert.equal(
      (await read()).batches.find((b) => b.id === "batch-a").quantity,
      12,
    );
    const matches = (
      await db.query(
        "select count(*)::int as count from inventory_requests where id='rollback'",
      )
    ).rows[0].count;
    assert.equal(matches, 0);
    await db.exec(`set "request.jwt.claim.sub"='${other}';`);
    assert.equal((await read()).ingredients.length, 0);
    await assert.rejects(
      send("cross-account", "use", use, other),
      /ingredient no longer exists/,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      send("anon", "ingredient", { name: "No", unit: "kg", threshold: 0 }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
