<script lang="ts">
import type { Dashboard, DashboardOptions, Renderer } from "@crossplot/core";
import { bin, category } from "@crossplot/core";
import { chart, useChart, useDashboard, useFilter, useFilters, useRows, useSummary } from "../src/index.js";

type Props = {
  options: DashboardOptions<{ x: number; kind: string }>;
  step: number;
  title: string;
  renderer: Renderer;
  expose: (api: unknown) => void;
};
let { options, step, title, renderer, expose }: Props = $props();

const dash = useDashboard(() => options);
const xs = useChart(dash, () => ({ dimension: bin("x", { step, extent: [0, 100] }), view: { title } }));
const summary = useSummary(dash);
const filters = useFilters(dash);
const kind = useFilter(dash, "kind");
const page = useRows(dash, { columns: ["x"], limit: 3 });
const kindSpec = { dimension: category("kind"), view: { title: "Kind" }, renderer };
// svelte-ignore state_referenced_locally
expose({ dash, xs, summary, filters, kind, page });
</script>

<p class="count">{summary.current ? `${summary.current.selected} of ${summary.current.total}` : "Loading"}</p>
<div class="xs" use:xs.ref></div>
<div class="kinds" use:chart={{ dashboard: dash.current as Dashboard | null, spec: kindSpec }}></div>
