import { createDashboard, type Dashboard, type DashboardOptions, type FieldOf, type Row } from "@crossplot/core";
import { useEffect, useRef, useState } from "react";

/**
 * Create a dashboard for the lifetime of a component. Returns null until the engine has loaded
 * the data, and always while rendering on the server.
 *
 * The dashboard is created once and recreated only when `options.data` or `options.engine`
 * changes (by identity), so keep the data in state, a memo or a module constant. The other
 * options are read when it is created. Creation waits one microtask, so a StrictMode
 * mount, unmount and mount starts exactly one engine (and one worker). The dashboard is destroyed
 * on unmount. A failure to load is thrown during render, for an error boundary to catch.
 */
export function useDashboard<T extends Row>(options: DashboardOptions<T>): Dashboard<FieldOf<T>> | null {
  const [dashboard, setDashboard] = useState<Dashboard<FieldOf<T>> | null>(null);
  const [error, setError] = useState<{ error: unknown } | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { data, engine } = options;

  useEffect(() => {
    // `data` and `engine` are the dependencies; the rest is read from the latest options.
    void data;
    void engine;
    let cancelled = false;
    let created: Dashboard<FieldOf<T>> | null = null;
    queueMicrotask(() => {
      if (cancelled) return;
      createDashboard(latest.current).then(
        (d) => {
          if (cancelled) return d.destroy();
          created = d;
          setDashboard(d);
        },
        (err: unknown) => {
          if (!cancelled) setError({ error: err });
        },
      );
    });
    return () => {
      cancelled = true;
      created?.destroy();
      setDashboard(null);
      setError(null);
    };
  }, [data, engine]);

  if (error) throw error.error;
  return dashboard;
}
