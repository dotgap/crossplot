/** Colors the docs site passes to each live example, read from its light or dark theme. */
export interface ExampleTheme {
  /** Fill for selected bins. */
  readonly color: string;
  /** Fill for bins outside a chart's own filter. */
  readonly muted: string;
}

/** A live example: draw into `el` and return a cleanup function. */
export type MountExample = (el: HTMLElement, theme: ExampleTheme) => Promise<() => void>;

/** Find a child element the example created, or fail loudly. */
export function $(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
}
