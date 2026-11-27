// Lets tsc import the example components; Vite compiles them for the site.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<{ theme: import("./theme.js").ExampleTheme }>;
  export default component;
}

declare module "*.svelte" {
  import type { Component } from "svelte";

  const component: Component<{ theme: import("./theme.js").ExampleTheme }>;
  export default component;
}
