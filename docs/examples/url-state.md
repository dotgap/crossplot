# Filter state

<script setup>
import { mount } from "./filter-state.ts";
</script>

Filter state is a plain object keyed by chart id. Brush, click, or use the buttons; the JSON below is the store's snapshot, live. Saving and restoring it is all it takes to put a dashboard's state in a URL, `localStorage` or a database.

<LiveExample :run="mount" caption="Brush, then save and restore" />

<<< @/examples/filter-state.ts
