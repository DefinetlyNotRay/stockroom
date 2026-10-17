import type { Inventory } from "./inventory";
export type ReportFilters = {
  from?: string;
  to?: string;
  ingredientIds?: string[];
};
export function filterReport(
  data: Inventory,
  filters: ReportFilters = {},
): Inventory {
  const validDate = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    (filters.from && !validDate(filters.from)) ||
    (filters.to && !validDate(filters.to)) ||
    (filters.from && filters.to && filters.from > filters.to)
  )
    throw Error("Choose a valid date range.");
  if (filters.ingredientIds && !filters.ingredientIds.length)
    throw Error("Select at least one ingredient.");
  const selected = filters.ingredientIds
    ? new Set(filters.ingredientIds)
    : null;
  if (
    selected &&
    [...selected].some((id) => !data.ingredients.some((i) => i.id === id))
  )
    throw Error("Selected ingredient is unavailable.");
  const ingredients = data.ingredients.filter(
    (i) => !selected || selected.has(i.id),
  );
  const ids = new Set(ingredients.map((i) => i.id));
  return {
    ingredients,
    // Quantities are current balances, not a reconstruction of historical stock.
    batches: data.batches.filter((b) => ids.has(b.ingredientId)),
    movements: data.movements
      .filter((m) => {
        if (!ids.has(m.ingredientId)) return false;
        const date = new Date(m.date);
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return (
          (!filters.from || day >= filters.from) &&
          (!filters.to || day <= filters.to)
        );
      })
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
  };
}
