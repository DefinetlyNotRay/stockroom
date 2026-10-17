import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const setup = `create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
insert into auth.users values('${A}'),('${B}');`;
const migrations = new URL("../supabase/migrations/", import.meta.url);
const migration = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, migrations), "utf8"))
  .join("\n");

test("normalized inventory database: permissions, transactions, FIFO, adjustments and retries", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(setup);
    await db.exec(migration);
    await db.exec(`set role authenticated;set "request.jwt.claim.sub"='${A}';`);
    const day = (await db.query("select current_date::text as day")).rows[0]
      .day;
    const cmd = async (id, kind, data) =>
      (
        await db.query(
          "select public.inventory_command($1,$2,$3::jsonb) as state",
          [id, kind, JSON.stringify({ today: day, ...data })],
        )
      ).rows[0].state;
    const read = async () =>
      (await db.query("select public.inventory_read() as state")).rows[0].state;
    await t.test(
      "app cannot directly overwrite quantity or history",
      async () => {
        await assert.rejects(
          db.query(
            `insert into public.ingredients(user_id,id,name,unit) values('${A}','bad','Bad','kg')`,
          ),
          /permission denied/,
        );
      },
    );
    await cmd("flour", "ingredient", {
      name: "Flour",
      unit: "kg",
      threshold: 2,
    });
    await cmd("old", "receive", {
      ingredientId: "flour",
      code: "A",
      quantity: 12,
      received: "2026-01-01",
      expiry: "2099-01-01",
    });
    await cmd("new", "receive", {
      ingredientId: "flour",
      code: "B",
      quantity: 20,
      received: "2026-02-01",
      expiry: "2099-01-01",
    });
    await t.test("FIFO splits one entry into two batch movements", async () => {
      const state = await cmd("use1", "use", {
        ingredientId: "flour",
        quantity: 15,
      });
      assert.equal(state.batches.find((b) => b.id === "old").quantity, 2);
      assert.equal(state.batches.find((b) => b.id === "new").quantity, 15);
      const movements = await db.query(
        `select quantity from public.stock_movements where entry_id='use1' order by quantity`,
      );
      assert.deepEqual(
        movements.rows.map((r) => Number(r.quantity)),
        [-10, -5],
      );
      const count = await db.query(
        `select count(*)::int as count from public.stock_entries where id='use1'`,
      );
      assert.equal(count.rows[0].count, 1);
    });
    await t.test("retry does not deduct stock twice", async () => {
      const before = await read();
      assert.deepEqual(
        await cmd("use1", "use", { ingredientId: "flour", quantity: 15 }),
        before,
      );
      await assert.rejects(
        cmd("use1", "use", { ingredientId: "flour", quantity: 1 }),
        /already used/,
      );
    });
    await t.test(
      "insufficient stock rolls back all allocations and history",
      async () => {
        const before = await read();
        await assert.rejects(
          cmd("baduse", "use", { ingredientId: "flour", quantity: 99 }),
          /Not enough/,
        );
        assert.deepEqual(await read(), before);
      },
    );
    await t.test(
      "manual selection can consume the reserved remainder",
      async () => {
        const state = await cmd("manual", "use", {
          ingredientId: "flour",
          quantity: 2,
          batchId: "old",
        });
        assert.equal(state.batches.find((b) => b.id === "old").quantity, 0);
      },
    );
    await t.test(
      "adjustments require a reason and retain the signed difference",
      async () => {
        await assert.rejects(
          cmd("adj", "adjust", {
            ingredientId: "flour",
            batchId: "new",
            quantity: 13,
          }),
          /reason/,
        );
        const state = await cmd("adj", "adjust", {
          ingredientId: "flour",
          batchId: "new",
          quantity: 13,
          reason: "Damaged",
        });
        assert.equal(state.batches.find((b) => b.id === "new").quantity, 13);
        const adjustment = state.movements.find((m) => m.type === "adjusted");
        assert.equal(adjustment.quantity, -2);
        assert.equal(adjustment.reason, "Damaged");
      },
    );
    await t.test(
      "expired stock cannot be consumed automatically or manually",
      async () => {
        await cmd("expired", "receive", {
          ingredientId: "flour",
          code: "EX",
          quantity: 50,
          received: "2000-01-01",
          expiry: "2001-01-01",
        });
        await assert.rejects(
          cmd("expired-use", "use", {
            ingredientId: "flour",
            batchId: "expired",
            quantity: 1,
          }),
          /Not enough/,
        );
        await assert.rejects(
          cmd("expired-auto", "use", { ingredientId: "flour", quantity: 12 }),
          /Not enough/,
        );
      },
    );
    await t.test(
      "minimum edits and zero minimum are enforced by the server",
      async () => {
        await cmd("min", "settings", { ingredientId: "flour", threshold: 0 });
        const state = await cmd("empty", "use", {
          ingredientId: "flour",
          quantity: 13,
        });
        assert.equal(state.batches.find((b) => b.id === "new").quantity, 0);
      },
    );
    await t.test(
      "invalid dates and numeric quantities are rejected",
      async () => {
        for (const quantity of [-1, 0, 1.0001, "NaN"])
          await assert.rejects(
            cmd("invalid", "use", { ingredientId: "flour", quantity }),
          );
        await assert.rejects(
          cmd("dates", "receive", {
            ingredientId: "flour",
            code: "BAD",
            quantity: 1,
            received: "2026-02-01",
            expiry: "2026-01-01",
          }),
        );
      },
    );
    await t.test(
      "another account cannot read, mutate, or reference the first account stock",
      async () => {
        await db.exec(`set "request.jwt.claim.sub"='${B}';`);
        assert.deepEqual(await read(), {
          ingredients: [],
          batches: [],
          movements: [],
        });
        assert.equal(
          (
            await db.query(
              "select count(*)::int as count from public.stock_movements",
            )
          ).rows[0].count,
          0,
        );
        await assert.rejects(
          cmd("cross", "use", { ingredientId: "flour", quantity: 1 }),
          /Ingredient not found/,
        );
        await assert.rejects(
          db.query(`update public.batches set quantity=100`),
          /permission denied/,
        );
        await assert.rejects(
          db.query(`delete from public.stock_movements`),
          /permission denied/,
        );
      },
    );
    await t.test(
      "existing phone inventory imports once without losing balances",
      async () => {
        const phone = {
          ingredients: [{ id: "oil", name: "Oil", unit: "L", threshold: 0 }],
          batches: [
            {
              id: "oil1",
              ingredientId: "oil",
              code: "O1",
              received: "2026-01-01",
              expiry: "2099-01-01",
              quantity: 8,
            },
          ],
          movements: [],
        };
        const run = async () =>
          (
            await db.query(
              "select public.inventory_import($1::jsonb) as state",
              [JSON.stringify(phone)],
            )
          ).rows[0].state;
        const state = await run();
        assert.equal(state.batches[0].quantity, 8);
        assert.equal(state.movements[0].reason, "Imported opening balance");
        assert.deepEqual(await run(), state);
        const different = {
          ...phone,
          ingredients: [
            { id: "other", name: "Other", unit: "kg", threshold: 0 },
          ],
        };
        await assert.rejects(
          db.query("select public.inventory_import($1::jsonb)", [
            JSON.stringify(different),
          ]),
          /already imported/,
        );
        await db.exec(`set "request.jwt.claim.sub"='${A}';`);
        await assert.rejects(run(), /empty cloud account/);
      },
    );
    await t.test(
      "batch balances reconcile with immutable movement history",
      async () => {
        const result = await db.query(
          `select b.id from public.batches b left join public.stock_movements m on (b.user_id,b.id)=(m.user_id,m.batch_id) group by b.user_id,b.id,b.quantity having b.quantity<>coalesce(sum(m.quantity),0)`,
        );
        assert.equal(result.rows.length, 0);
        const entries = await db.query(
          `select e.id from public.stock_entries e join public.stock_movements m on (e.user_id,e.id)=(m.user_id,m.entry_id) group by e.user_id,e.id,e.quantity having e.quantity<>sum(m.quantity)`,
        );
        assert.equal(entries.rows.length, 0);
      },
    );
    await t.test("anonymous calls are denied", async () => {
      await db.exec("reset role;set role anon;");
      await assert.rejects(read(), /permission denied/);
    });
  } finally {
    await db.close();
  }
});
