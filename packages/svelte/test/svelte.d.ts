// Lets tsc import test components; vite-plugin-svelte compiles them when the tests run.
declare module "*.svelte" {
  import type { Component } from "svelte";

  const component: Component<any>;
  export default component;
}
