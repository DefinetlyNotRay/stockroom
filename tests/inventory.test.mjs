import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, amount, move, today, validDate } from "../src/inventory.ts";
const ingredient = { id: "flour", name: "Flour", unit: "kg", threshold: 2 };
function fixture() {
  return {
    ingredients: [ingredient],
    batches: [
      {
        id: "new",
        ingredientId: "flour",
        code: "B",
        received: "2026-02-01",
        expiry: "2099-01-01",
        quantity: 20,
      },
      {
        id: "old",
        ingredientId: "flour",
        code: "A",
        received: "2026-01-01",
        expiry: "2099-01-01",
        quantity: 12,
      },
    ],
    movements: [],
  };
}
test("FIFO uses received order and preserves the configured remainder", () => {
  assert.deepEqual(allocate(fixture(), ingredient, 15), [
    { batchId: "old", quantity: 10 },
    { batchId: "new", quantity: 5 },
  ]);
});
test("manual allocation can use the remainder", () => {
  assert.deepEqual(allocate(fixture(), ingredient, 12, "old"), [
    { batchId: "old", quantity: 12 },
  ]);
});
test("expired stock is excluded", () => {
  const state = fixture();
  state.batches[1].expiry = "2000-01-01";
  assert.deepEqual(allocate(state, ingredient, 10), [
    { batchId: "new", quantity: 10 },
  ]);
  assert.throws(() => allocate(state, ingredient, 1, "old"));
});
test("insufficient inventory fails without changing stock", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  assert.throws(() => allocate(state, ingredient, 29));
  assert.equal(JSON.stringify(state), before);
});
test("usage records batches and leaves the source unchanged", () => {
  const state = fixture();
  const next = move(
    state,
    "flour",
    allocate(state, ingredient, 15).map((a) => ({
      ...a,
      quantity: -a.quantity,
    })),
    "used",
  );
  assert.equal(next.batches.find((b) => b.id === "old").quantity, 2);
  assert.equal(next.batches.find((b) => b.id === "new").quantity, 15);
  assert.equal(next.movements.length, 2);
  assert.equal(next.movements[0].batch, "A");
  assert.equal(state.movements.length, 0);
});
test("zero threshold empties a batch and decimals remain accurate", () => {
  const state = fixture();
  state.batches[1].quantity = 0.3;
  const allocations = allocate(state, { ...ingredient, threshold: 0 }, 0.4);
  assert.deepEqual(allocations, [
    { batchId: "old", quantity: 0.3 },
    { batchId: "new", quantity: 0.1 },
  ]);
});
test("adjustment retains its reason and cannot make stock negative", () => {
  const next = move(
    fixture(),
    "flour",
    [{ batchId: "old", quantity: -1.5 }],
    "adjusted",
    "Damaged",
  );
  assert.equal(next.movements[0].reason, "Damaged");
  assert.equal(next.batches[1].quantity, 10.5);
  assert.throws(() =>
    move(fixture(), "flour", [{ batchId: "old", quantity: -13 }], "used"),
  );
});
test("validates numeric input and real calendar dates", () => {
  for (const value of ["NaN", "Infinity", "-2", "1e3", "1.2345", ""])
    assert.throws(() => amount(value));
  assert.throws(() => amount("0"));
  assert.equal(amount("0", true), 0);
  assert.equal(amount("1.125"), 1.125);
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate(today()), true);
});
