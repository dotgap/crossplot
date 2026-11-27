import type { Dashboard, Filter, FilterState, RowsQuery, RowsResult, Summary } from "@crossplot/core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const empty: FilterState = Object.freeze({});
const noop = () => {};
const emptyFilters = () => empty;
const none = () => null;

function useFilterStore<T>(dashboard: Dashboard | null, read: (state: FilterState) => T, fallback: () => T): T {
  const subscribe = useCallback(
    (onChange: () => void) => (dashboard ? dashboard.filters.subscribe(onChange) : noop),
    [dashboard],
  );
  return useSyncExternalStore(
    subscribe,
    () => (dashboard ? read(dashboard.filters.snapshot.filters) : fallback()),
    fallback,
  );
}

/**
 * Every filter, by chart id: the same plain object as `dashboard.filters.snapshot.filters`,
 * replaced on each change. Empty before the dashboard is ready and on the server.
 */
export function useFilters(dashboard: Dashboard | null): FilterState {
  return useFilterStore(dashboard, (state) => state, emptyFilters);
}

/** One chart's filter by id, or null. */
export function useFilter(dashboard: Dashboard | null, id: string): Filter | null {
  return useFilterStore(dashboard, (state) => state[id] ?? null, none);
}

/** Selected and total row counts after the latest update, or null before the dashboard is ready. */
export function useSummary(dashboard: Dashboard | null): Summary | null {
  const subscribe = useCallback(
    (onChange: () => void) => (dashboard ? dashboard.onUpdate(onChange) : noop),
    [dashboard],
  );
  return useSyncExternalStore(subscribe, () => dashboard?.summary ?? null, none);
}

/**
 * Rows passing every filter, fetched again after every update; null until the first page
 * arrives. Answers that arrive out of order are dropped. `query` is compared as JSON.
 */
export function useRows<F extends string>(
  dashboard: Dashboard<F> | null,
  query: RowsQuery & { columns?: readonly F[]; sort?: F | `-${F}` } = {},
): RowsResult | null {
  const [result, setResult] = useState<RowsResult | null>(null);
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!dashboard) return;
    const q = JSON.parse(key) as typeof query;
    let latest = 0;
    let active = true;
    const fetchRows = () => {
      const mine = ++latest;
      dashboard.rows(q).then(
        (r) => {
          if (active && mine === latest) setResult(r);
        },
        (err: unknown) => console.error("[crossplot] rows failed", err),
      );
    };
    const stop = dashboard.onUpdate(fetchRows);
    return () => {
      active = false;
      stop();
      setResult(null);
    };
  }, [dashboard, key]);

  return result;
}
