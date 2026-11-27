<script setup lang="ts">
import { useData } from "vitepress";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { MountExample } from "../../../examples/theme.js";

const props = defineProps<{
  /** The example's mount function. */
  run: MountExample;
  /** Shown next to the "Live" label. */
  caption?: string;
}>();

const host = ref<HTMLElement | null>(null);
const error = ref<string | null>(null);
const { isDark } = useData();
let cleanup: (() => void) | null = null;
let generation = 0;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function start() {
  stop();
  const el = host.value;
  if (!el) return;
  const mine = ++generation;
  error.value = null;
  try {
    const done = await props.run(el, { color: token("--cp-accent"), muted: token("--cp-muted-mark") });
    if (mine === generation) cleanup = done;
    else done();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function stop() {
  generation++;
  cleanup?.();
  cleanup = null;
  host.value?.replaceChildren();
}

onMounted(start);
onBeforeUnmount(stop);
// Plot needs real colors, so redraw when the theme flips.
watch(isDark, () => requestAnimationFrame(start));
</script>

<template>
  <div class="cp-live">
    <div class="cp-live-bar">
      <span><span class="cp-live-label">Live</span> {{ caption }}</span>
    </div>
    <div ref="host" />
    <p v-if="error" class="cp-note">This example failed to load: {{ error }}</p>
  </div>
</template>
