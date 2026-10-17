export type Ingredient = {
  id: string;
  name: string;
  unit: string;
  threshold: number;
};
export type Batch = {
  id: string;
  ingredientId: string;
  code: string;
  received: string;
  expiry: string;
  quantity: number;
};
export type Movement = {
  id: string;
  ingredientId: string;
  batchId: string;
  batch: string;
  quantity: number;
  type: "received" | "used" | "adjusted";
  date: string;
  reason?: string;
};
export type Inventory = {
  ingredients: Ingredient[];
  batches: Batch[];
  movements: Movement[];
};
export const emptyInventory: Inventory = {
  ingredients: [],
  batches: [],
  movements: [],
};
export function parseInventory(value: unknown): Inventory {
  if (!value || typeof value !== "object") throw Error("Invalid stock data.");
  const state = value as Inventory;
  if (
    !Array.isArray(state.ingredients) ||
    !Array.isArray(state.batches) ||
    !Array.isArray(state.movements)
  )
    throw Error("Invalid stock data.");
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (
    state.ingredients.some(
      (i) =>
        !i ||
        !text(i.id) ||
        !text(i.name) ||
        !text(i.unit) ||
        !Number.isFinite(i.threshold) ||
        i.threshold < 0,
    )
  )
    throw Error("Invalid ingredients.");
  const ids = new Set(state.ingredients.map((i) => i.id));
  const batches = new Set(state.batches.map((b) => b?.id));
  const batchIngredients = new Map(
    state.batches.map((b) => [b.id, b.ingredientId]),
  );
  if (
    ids.size !== state.ingredients.length ||
    batches.size !== state.batches.length
  )
    throw Error("Duplicate records.");
  if (
    state.batches.some(
      (b) =>
        !b ||
        !text(b.id) ||
        !text(b.code) ||
        !ids.has(b.ingredientId) ||
        !Number.isFinite(b.quantity) ||
        b.quantity < 0 ||
        !validDate(b.received) ||
        !validDate(b.expiry),
    )
  )
    throw Error("Invalid batches.");
  if (
    state.movements.some(
      (m) =>
        !m ||
        !text(m.id) ||
        !text(m.batch) ||
        !ids.has(m.ingredientId) ||
        batchIngredients.get(m.batchId) !== m.ingredientId ||
        !Number.isFinite(m.quantity) ||
        !["received", "used", "adjusted"].includes(m.type) ||
        typeof m.date !== "string" ||
        Number.isNaN(Date.parse(m.date)) ||
        (m.reason !== undefined && typeof m.reason !== "string"),
    )
  )
    throw Error("Invalid movements.");
  return state;
}
export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const round = (n: number) => Math.round(n * 1000) / 1000;
export function amount(value: string, allowZero = false) {
  if (!/^\d+(\.\d{1,3})?$/.test(value.trim()))
    throw new Error("Enter a quantity with up to 3 decimals.");
  const n = Number(value);
  if (!Number.isFinite(n) || n > 1e12 || (allowZero ? n < 0 : n <= 0))
    throw new Error("Enter a valid quantity.");
  return n;
}
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function allocate(
  state: Inventory,
  ingredient: Ingredient,
  quantity: number,
  batchId?: string,
) {
  let left = quantity;
  const allocations: { batchId: string; quantity: number }[] = [];
  const batches = state.batches
    .filter(
      (b) =>
        b.ingredientId === ingredient.id &&
        b.expiry >= today() &&
        (!batchId || b.id === batchId),
    )
    .sort(
      (a, b) =>
        a.received.localeCompare(b.received) || a.id.localeCompare(b.id),
    );
  for (const b of batches) {
    const available = Math.max(
      0,
      round(b.quantity - (batchId ? 0 : ingredient.threshold)),
    );
    const take = Math.min(left, available);
    if (take > 0) allocations.push({ batchId: b.id, quantity: take });
    left = round(left - take);
    if (!left) break;
  }
  if (left > 0)
    throw new Error(
      "Not enough available stock. Check batches or choose manually.",
    );
  return allocations;
}
export function move(
  state: Inventory,
  ingredientId: string,
  entries: { batchId: string; quantity: number }[],
  type: Movement["type"],
  reason?: string,
): Inventory {
  if (
    !state.ingredients.some((i) => i.id === ingredientId) ||
    entries.some(
      (e) =>
        !Number.isFinite(e.quantity) ||
        e.quantity === 0 ||
        !state.batches.some(
          (b) => b.id === e.batchId && b.ingredientId === ingredientId,
        ),
    )
  )
    throw new Error("Invalid stock movement.");
  const movements = entries.map((e) => ({
    id: uid(),
    ingredientId,
    batchId: e.batchId,
    batch: state.batches.find((b) => b.id === e.batchId)!.code,
    quantity: e.quantity,
    type,
    date: new Date().toISOString(),
    reason,
  }));
  const batches = state.batches.map((b) => ({
    ...b,
    quantity: round(
      b.quantity +
        entries
          .filter((e) => e.batchId === b.id)
          .reduce((sum, e) => sum + e.quantity, 0),
    ),
  }));
  if (batches.some((b) => b.quantity < 0))
    throw new Error("Stock cannot be negative.");
  return { ...state, batches, movements: [...movements, ...state.movements] };
}
