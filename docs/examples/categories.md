# Categories and top-N

<script setup>
import { mount } from "./categories.ts";
</script>

Category charts filter by click. `top()` keeps the busiest origins and folds the rest into an "Other" bin, which this chart leaves out with `omit`. The third chart groups by carrier again, under its own id, to show the mean delay instead of a count. The hour chart's `compare` outline shows the unfiltered shape behind your selection.

<LiveExample :run="mount" caption="Click bars; drag across the hours" />

<<< @/examples/categories.ts
