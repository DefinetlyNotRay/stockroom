import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("bulk count approval is transactional, idempotent, and bound to its owner", async () => {
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
    await db.exec(
      `set role authenticated;set "request.jwt.claim.sub"='${owner}';`,
    );
    const day = (await db.query("select current_date::text as day")).rows[0]
      .day;
    const command = (id, kind, data) =>
      db.query("select inventory_command($1,$2,$3::jsonb)", [
        id,
        kind,
        JSON.stringify({ today: day, ...data }),
      ]);
    await command("i", "ingredient", {
      name: "Flour",
      unit: "kg",
      threshold: 0,
    });
    for (const id of ["a", "b"])
      await command(id, "receive", {
        ingredientId: "i",
        code: id,
        quantity: 10,
        received: day,
        expiry: "2099-01-01",
      });
    const occurred = new Date().toISOString();
    const entries = [
      { batchId: "a", ingredientId: "i", expectedQuantity: 10, quantity: 0 },
      { batchId: "b", ingredientId: "i", expectedQuantity: 11, quantity: 14 },
    ];
    const send = (id, rows, account = owner) =>
      db.query(
        "select inventory_sync_opname($1,$2,'opname',$3::jsonb,$4::timestamptz)",
        [
          account,
          id,
          JSON.stringify({ entries: rows, reason: "Stock opname" }),
          occurred,
        ],
      );
    const read = async () =>
      (await db.query("select inventory_read() as state")).rows[0].state;
    await assert.rejects(send("count", entries), /Sync conflict/);
    assert.deepEqual(
      (await read()).batches.map((b) => b.quantity),
      [10, 10],
    );
    assert.equal(
      (await read()).movements.filter((m) => m.type === "adjusted").length,
      0,
    );
    entries[1].expectedQuantity = 10;
    await assert.rejects(send("wrong-owner", entries, other), /account/);
    await assert.rejects(
      send("duplicates", [entries[0], entries[0]]),
      /duplicate/,
    );
    await send("count", entries);
    await send("count", entries);
    assert.deepEqual(
      (await read()).batches.map((b) => b.quantity),
      [0, 14],
    );
    assert.equal(
      (await read()).movements.filter((m) => m.type === "adjusted").length,
      2,
    );
    await assert.rejects(
      send("count", [{ ...entries[0], quantity: 1 }]),
      /already used/,
    );
  } finally {
    await db.close();
  }
});
