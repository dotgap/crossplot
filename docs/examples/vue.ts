import { createApp } from "vue";
import type { MountExample } from "./theme.js";
import VueDashboard from "./VueDashboard.vue";

/** Mounts the Vue example as its own small app, so the page can redraw it when the theme flips. */
export const mount: MountExample = async (el, theme) => {
  const app = createApp(VueDashboard, { theme });
  app.mount(el);
  return () => app.unmount();
};
