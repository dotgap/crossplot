import { mount as mountComponent, unmount } from "svelte";
import SvelteDashboard from "./SvelteDashboard.svelte";
import type { MountExample } from "./theme.js";

/** Mounts the Svelte example into the page; the docs site itself is a Vue app. */
export const mount: MountExample = async (el, theme) => {
  const app = mountComponent(SvelteDashboard, { target: el, props: { theme } });
  return () => void unmount(app);
};
