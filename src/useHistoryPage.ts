import { useEffect, useMemo, useState } from "react";
import { HISTORY_PAGE_SIZE, readHistoryPage } from "./cloud";
import type { Movement } from "./inventory";

export default function useHistoryPage({
  account,
  active,
  ingredientId,
  search,
  from,
  to,
  oldest,
  revision,
}: {
  account: string | null;
  active: boolean;
  ingredientId: string | null;
  search: string;
  from: string;
  to: string;
  oldest: boolean;
  revision: unknown;
}) {
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const filterKey = JSON.stringify([
    account,
    ingredientId,
    debouncedSearch,
    from,
    to,
    oldest,
  ]);
  const [position, setPosition] = useState({ key: filterKey, page: 0 });
  const page = position.key === filterKey ? position.page : 0;
  const key = `${filterKey}:${page}`;
  const [retry, setRetry] = useState(0);
  const request = useMemo(
    () => ({ key, revision, retry, active }),
    [key, revision, retry, active],
  );
  const [result, setResult] = useState<{
    request: typeof request | null;
    rows: Movement[];
    error: string;
  }>({ request: null, rows: [], error: "" });
  useEffect(() => {
    if (!account || !active) return;
    let cancelled = false;
    readHistoryPage({
      page,
      ingredientId: ingredientId || undefined,
      search: debouncedSearch,
      from,
      to,
      oldest,
    })
      .then((rows) => {
        if (!cancelled) setResult({ request, rows, error: "" });
      })
      .catch((error) => {
        if (!cancelled)
          setResult({
            request,
            rows: [],
            error:
              error instanceof Error
                ? error.message
                : "Could not load history.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [
    account,
    active,
    request,
    page,
    ingredientId,
    debouncedSearch,
    from,
    to,
    oldest,
  ]);
  return {
    page,
    setPage: (next: number) => setPosition({ key: filterKey, page: next }),
    rows:
      result.request === request ? result.rows.slice(0, HISTORY_PAGE_SIZE) : [],
    hasNext:
      result.request === request && result.rows.length > HISTORY_PAGE_SIZE,
    loading: result.request !== request || search !== debouncedSearch,
    error: result.request === request ? result.error : "",
    retry: () => setRetry((value) => value + 1),
  };
}
