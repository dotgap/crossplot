import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import LiveExample from "./components/LiveExample.vue";
import "./style.css";

// VitePress loads the theme from this module's default export.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("LiveExample", LiveExample);
  },
} satisfies Theme;
