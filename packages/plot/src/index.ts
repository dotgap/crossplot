/**
 * Observable Plot renderer for crossplot charts.
 *
 * @module @crossplot/plot
 */
import type {
  AxisInfo,
  ChartData,
  Datum,
  DimensionInfo,
  Filter,
  Intent,
  MountContext,
  Renderer,
  RenderHandle,
} from "@crossplot/core";
import * as Plot from "@observablehq/plot";

/** The Observable Plot marks a chart can draw as. */
export type PlotMark =
  | "rectY"
  | "barY"
  | "barX"
  | "line"
  | "areaY"
  | "rect"
  | "cell"
  | "stackY"
  | "streamY"
  | "shareX"
  | "bump"
  | "map";

/** One way to place a map's dots, such as "today" and "when they lived". */
export interface MapLayout {
  /** Button label. */
  readonly label: string;
  /**
   * Where to draw a cell's dot, as [x, y] in the grid's units (longitude,
   * latitude). Defaults to the cell's center. Return null to hide the dot.
   * While a layout with a position is active, the map can't be brushed,
   * because its dots no longer sit on the grid the filter applies to.
   */
  readonly position?: (d: Datum) => readonly [number, number] | null;
  /**
   * Marks drawn under the dots, such as land outlines. A function gets the
   * chart's data and is called on every update; the map is only redrawn
   * when it returns a different array.
   */
  readonly underlay?: readonly Plot.Markish[] | ((data: ChartData) => readonly Plot.Markish[]);
}

/** The `view` of a chart drawn by {@link plotRenderer}. Every field is optional. */
export interface PlotView {
  /**
   * Mark to draw. Defaults: `rectY` for binned dimensions, `barX` for
   * categories, `rect` for grids (`cell` when a grid axis is categorical).
   * `stackY` draws a grid of binned x by categorical y as stacked bars, one
   * color per y key, brushable along x; `streamY` draws the same grid as a
   * smooth streamgraph centered on the axis.
   * `shareX` draws a category dimension as one bar split into its parts.
   * `bump` draws a grid of categorical x by categorical y as a bump chart:
   * one line per x key, ranked within each y key (y keys run left to right).
   * With `colors`, lines without a color stay grey until something is selected.
   * `map` draws a binned grid, such as `lngLat()`, as dots sized by value on
   * an equirectangular map; see `layouts`.
   */
  readonly mark?: PlotMark;
  /** Brush direction for binned dimensions. Default `x` (1-D) or `xy` (grid). `false` turns it off. */
  readonly brush?: "x" | "xy" | false;
  /** Click selection for categories. Default `multi`. `false` turns it off. */
  readonly select?: "single" | "multi" | false;
  /**
   * Category order: dimension order (`key`, the default), by the current
   * value, or by the unfiltered baseline (`-baseline` keeps bars in place
   * while filters change).
   */
  readonly sort?: "key" | "value" | "-value" | "baseline" | "-baseline";
  /** Category keys not to draw, such as the "Other" bin of `top()`. */
  readonly omit?: readonly string[];
  /** Title drawn above the chart. */
  readonly title?: string;
  /** Width in pixels. Defaults to the container's width, and follows it. */
  readonly width?: number;
  /** Default 200 for 1-D charts, 300 for grids; barX grows with the category count. */
  readonly height?: number;
  /** Fill for selected bins. */
  readonly color?: string;
  /** Fill for bins outside this chart's own filter. */
  readonly mutedColor?: string;
  /** Color scheme for grids. Default `blues`. */
  readonly scheme?: string;
  /** x axis label. `null` hides it. */
  readonly xLabel?: string | null;
  /** y axis label. `null` hides it. */
  readonly yLabel?: string | null;
  /**
   * Colors by key: the series of a `stackY` chart (keys without one use
   * Plot's categorical scheme), or the selected bars of a category chart.
   */
  readonly colors?: Readonly<Record<string, string>>;
  /** Stacking order for `stackY`, bottom first. Default: the dimension's key order. */
  readonly series?: readonly string[];
  /**
   * Draw the unfiltered distribution as a dashed outline, scaled to the
   * current total, so the shape of a selection compares with the shape of
   * everything. Works with `rectY`, `barX` and `barY`.
   */
  readonly compare?: boolean;
  /** Value labels at the end of `barX` bars. */
  readonly labels?: boolean;
  /** Number format for labels and the default tooltip. */
  readonly format?: (value: number) => string;
  /**
   * Hover tooltip. Return text with one line per "\n"; the first line is
   * bold. Gets the bin under the pointer and, for `stackY`, every series in
   * that bin. `false` turns it off.
   */
  readonly tooltip?: false | ((d: Datum, bin: readonly Datum[]) => string);
  /** Run a binned x axis right to left, e.g. for "millions of years ago". */
  readonly reverse?: boolean;
  /** Static marks drawn under the data, such as shaded eras. `view.plot.marks` draw on top. */
  readonly underlay?: readonly Plot.Markish[];
  /**
   * `map` only: ways to place the dots, shown as buttons above the map when
   * there is more than one. Switching animates every dot to its new place.
   * Default: one layout with dots at cell centers.
   */
  readonly layouts?: readonly MapLayout[];
  /** `map` only: the layout to start with. Default 0. */
  readonly layout?: number;
  /** `map` only: radius in pixels of the dot with the largest unfiltered value. Default 12. */
  readonly radius?: number;
  /** Extra Plot options, merged last. */
  readonly plot?: Plot.PlotOptions;
}

/** Options for {@link plotRenderer}. */
export interface PlotRendererOptions {
  /** Defaults merged under every chart's view. */
  readonly defaults?: Omit<PlotView, "mark" | "plot">;
}

const ACCENT = "#4c7dff";
const MUTED = "#c9ced6";
const MIN_DRAG = 3;

/** Observable Plot renderer. Pass it as `renderer` to `createDashboard` or a chart spec. */
export function plotRenderer(options: PlotRendererOptions = {}): Renderer<PlotView> {
  return {
    mount: (el, view, emit, ctx) => mountChart(el, { ...options.defaults, ...view }, emit, ctx),
  };
}

type Scale = Plot.Scale;

interface Frame {
  readonly x: Scale | undefined;
  readonly y: Scale | undefined;
  /** Plot frame in container pixels. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function defaultMark(dim: DimensionInfo): PlotMark {
  if (dim.y) return dim.x.kind === "category" || dim.y.kind === "category" ? "cell" : "rect";
  return dim.x.kind === "category" ? "barX" : "rectY";
}

function mountChart(el: HTMLElement, view: PlotView, emit: (intent: Intent) => void, ctx: MountContext): RenderHandle {
  const dim = ctx.dimension;
  const mark = view.mark ?? defaultMark(dim);
  const isCategory = dim.x.kind === "category" && !dim.y;
  const isMap = mark === "map";
  const brushMode =
    view.brush === false || isCategory || mark === "cell" || mark === "bump"
      ? null
      : mark === "stackY" || mark === "streamY"
        ? "x"
        : isMap
          ? "xy"
          : (view.brush ?? (dim.y ? "xy" : "x"));
  const selectMode = (isCategory || mark === "bump") && view.select !== false ? (view.select ?? "multi") : null;
  const layouts: readonly MapLayout[] = view.layouts?.length ? view.layouts : [{ label: "Map" }];
  let layout = Math.min(Math.max(0, view.layout ?? 0), layouts.length - 1);
  /** The map can be brushed only while its dots sit on their grid cells. */
  const canBrush = () => brushMode !== null && !(isMap && layouts[layout]!.position);

  const root = document.createElement("div");
  root.className = "crossplot-chart";
  root.dataset.chart = ctx.id;
  root.style.userSelect = "none";
  const holder = document.createElement("div");
  const overlay = svgEl("svg");
  overlay.setAttribute("class", "crossplot-overlay");
  Object.assign(overlay.style, { position: "absolute", left: "0", top: "0", overflow: "visible" });
  const brushRect = svgEl("rect");
  brushRect.setAttribute("fill", "currentColor");
  brushRect.setAttribute("fill-opacity", "0.08");
  brushRect.setAttribute("stroke", "currentColor");
  brushRect.setAttribute("stroke-opacity", "0.5");
  brushRect.setAttribute("visibility", "hidden");
  brushRect.style.pointerEvents = "none";
  // Streamgraphs dim what lies outside the brush instead of drawing a box.
  const shades = [svgEl("rect"), svgEl("rect")];
  for (const r of shades) {
    r.style.fill = "var(--crossplot-shade, Canvas)";
    r.setAttribute("fill-opacity", "0.7");
    r.setAttribute("visibility", "hidden");
    r.style.pointerEvents = "none";
  }
  overlay.append(brushRect, ...shades);
  // Map dots live in their own layer so they can move between updates.
  const dotLayer = svgEl("svg");
  dotLayer.setAttribute("class", "crossplot-dots");
  Object.assign(dotLayer.style, {
    position: "absolute",
    left: "0",
    top: "0",
    overflow: "visible",
    pointerEvents: "none",
  });
  const dotGroup = svgEl("g");
  dotLayer.append(dotGroup);
  const tip = document.createElement("div");
  tip.className = "crossplot-tooltip";
  tip.setAttribute("role", "tooltip");
  Object.assign(tip.style, {
    position: "absolute",
    pointerEvents: "none",
    visibility: "hidden",
    zIndex: "1",
    whiteSpace: "pre",
    font: "12px/1.4 system-ui, sans-serif",
    padding: "6px 8px",
    borderRadius: "6px",
    background: "var(--crossplot-tooltip-bg, Canvas)",
    color: "var(--crossplot-tooltip-fg, CanvasText)",
    border: "1px solid var(--crossplot-tooltip-border, rgba(127,127,127,.35))",
    boxShadow: "0 2px 8px rgba(0,0,0,.12)",
  });
  const stage = document.createElement("div");
  stage.style.position = "relative";
  stage.append(holder, ...(isMap ? [dotLayer] : []), overlay, tip);
  root.append(stage);
  if (isMap && layouts.length > 1) {
    const bar = document.createElement("div");
    bar.className = "crossplot-layouts";
    bar.setAttribute("role", "group");
    const buttons = layouts.map((l, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = l.label;
      b.dataset.layout = String(i);
      b.setAttribute("aria-pressed", String(i === layout));
      b.addEventListener("click", () => {
        if (i === layout) return;
        layout = i;
        for (const [j, other] of buttons.entries()) other.setAttribute("aria-pressed", String(j === i));
        root.dataset.layout = String(i);
        moving = true;
        draw();
      });
      return b;
    });
    bar.append(...buttons);
    root.prepend(bar);
  }
  root.dataset.layout = String(layout);
  if (view.title) {
    const h = document.createElement("div");
    h.className = "crossplot-title";
    h.textContent = view.title;
    root.prepend(h);
  }
  el.replaceChildren(root);

  let last: { data: ChartData; filter: Filter | null } | null = null;
  let frame: Frame | null = null;
  let width = view.width ?? (el.clientWidth || 640);
  /** Hit targets of the last draw, for marks that aren't plain bins or bands. */
  let targets: Target[] = [];

  // --- map state -------------------------------------------------------------
  /** Set while switching layouts, so dots take the slow path to their new place. */
  let moving = false;
  let basemapKey: { width: number; layout: number; underlay: readonly Plot.Markish[] | undefined } | null = null;
  const dots = new Map<number, SVGCircleElement>();
  const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const placeOverlay = (svg: SVGSVGElement) => {
    const top = `${svg.getBoundingClientRect().top - stage.getBoundingClientRect().top}px`;
    for (const layer of [overlay, dotLayer]) {
      layer.setAttribute("width", svg.getAttribute("width") ?? "0");
      layer.setAttribute("height", svg.getAttribute("height") ?? "0");
      layer.style.top = top;
    }
  };

  const drawMap = () => {
    if (!last) return;
    const current = layouts[layout]!;
    const underlay =
      typeof current.underlay === "function" ? current.underlay(last.data) : (current.underlay ?? view.underlay);
    const changed =
      !basemapKey || basemapKey.width !== width || basemapKey.layout !== layout || basemapKey.underlay !== underlay;
    if (changed) {
      const fade = basemapKey !== null && basemapKey.width === width;
      basemapKey = { width, layout, underlay };
      const figure = buildMap(dim, view, underlay ?? [], width);
      holder.replaceChildren(figure);
      if (fade && !reduceMotion())
        figure.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: "ease-out" });
      const svg = figure instanceof SVGSVGElement ? figure : figure.querySelector("svg");
      frame = svg ? readFrame(figure as unknown as Plot.Plot, svg) : null;
      if (svg) placeOverlay(svg);
    }
    if (!frame?.x || !frame.y) return;
    targets = placeDots(last.data, last.filter);
    if (!dragging) drawFilter(last.filter);
    overlay.style.cursor = canBrush() ? "crosshair" : "default";
  };

  const placeDots = (chart: ChartData, filter: Filter | null): Target[] => {
    const fx = frame!.x!;
    const fy = frame!.y!;
    const position = layouts[layout]!.position;
    const rows = chart.data;
    let max = 0;
    for (const d of rows) {
      const base = Number.isNaN(d.baseline) ? d.value : d.baseline;
      if (base > max) max = base;
    }
    const rMax = view.radius ?? 12;
    const accent = view.color ?? ACCENT;
    const muted = view.mutedColor ?? MUTED;
    const slow = moving && !reduceMotion();
    const out: Target[] = [];
    const fresh: SVGCircleElement[] = [];
    for (const d of rows) {
      const base = Number.isNaN(d.baseline) ? d.value : d.baseline;
      let c = dots.get(d.index);
      if (!(base > 0) && !c) continue;
      const p = position ? position(d) : ([(d.x0 + d.x1) / 2, ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2] as const);
      const x = p ? (fx.apply(p[0]) as number) : Number.NaN;
      const y = p ? (fy.apply(p[1]) as number) : Number.NaN;
      const r =
        max > 0 && d.value > 0 && Number.isFinite(x) && Number.isFinite(y) ? rMax * Math.sqrt(d.value / max) : 0;
      if (!c) {
        c = svgEl("circle");
        c.setAttribute("r", "1");
        c.setAttribute("vector-effect", "non-scaling-stroke");
        c.style.stroke = "var(--crossplot-dot-stroke, rgba(255,255,255,.7))";
        c.setAttribute("stroke-width", "0.75");
        c.setAttribute("fill-opacity", "0.8");
        c.dataset.base = String(base);
        dots.set(d.index, c);
        fresh.push(c);
      }
      const selected = isSelected(d, filter);
      c.setAttribute("fill", selected ? accent : muted);
      c.dataset.selected = String(selected);
      // A dot with nowhere to go stays where it was and shrinks away.
      const tx = Number.isFinite(x) ? x : Number(c.dataset.x ?? 0);
      const ty = Number.isFinite(y) ? y : Number(c.dataset.y ?? 0);
      c.dataset.x = String(tx);
      c.dataset.y = String(ty);
      c.style.transition = slow
        ? `transform 1.6s cubic-bezier(.55,0,.25,1) ${Math.round((tx / Math.max(1, width)) * 500)}ms`
        : reduceMotion()
          ? "none"
          : "transform .25s ease-out";
      c.style.transform = `translate(${tx}px, ${ty}px) scale(${r})`;
      if (r > 0) out.push({ datum: d, x: tx, y: ty, r });
    }
    if (fresh.length) {
      // Big dots first so small ones stay visible on top.
      const all = [...dots.values()].sort((a, b) => Number(b.dataset.base) - Number(a.dataset.base));
      dotGroup.replaceChildren(...all);
    }
    if (moving) setTimeout(() => (moving = false), 0);
    return out;
  };

  const draw = () => {
    if (!last) return;
    if (isMap) return drawMap();
    const figure = buildPlot(dim, mark, view, last.data, last.filter, width);
    holder.replaceChildren(figure);
    const svg = figure instanceof SVGSVGElement ? figure : figure.querySelector("svg");
    frame = svg ? readFrame(figure as unknown as Plot.Plot, svg) : null;
    if (svg) placeOverlay(svg);
    targets = frame ? hitTargets(dim, mark, view, frame, last.data.data) : [];
    if (!dragging) drawFilter(last.filter);
  };

  // --- brush & click ------------------------------------------------------
  let dragging: { x0: number; y0: number; pointer: number } | null = null;

  const local = (e: PointerEvent | MouseEvent) => {
    const r = overlay.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const inFrame = (px: number, py: number) =>
    frame !== null && px >= frame.left && px <= frame.right && py >= frame.top && py <= frame.bottom;

  const clampX = (px: number) => (frame ? Math.min(frame.right, Math.max(frame.left, px)) : px);
  const clampY = (py: number) => (frame ? Math.min(frame.bottom, Math.max(frame.top, py)) : py);

  const showRect = (x0: number, x1: number, y0: number, y1: number) => {
    brushRect.setAttribute("x", String(Math.min(x0, x1)));
    brushRect.setAttribute("y", String(Math.min(y0, y1)));
    brushRect.setAttribute("width", String(Math.abs(x1 - x0)));
    brushRect.setAttribute("height", String(Math.abs(y1 - y0)));
    brushRect.setAttribute("visibility", "visible");
  };

  const hideFilter = () => {
    brushRect.setAttribute("visibility", "hidden");
    for (const r of shades) r.setAttribute("visibility", "hidden");
  };

  const drawFilter = (filter: Filter | null) => {
    if (!canBrush() || !frame || !filter) return hideFilter();
    const fx = "range" in filter ? filter : "x" in filter ? filter.x : null;
    const fy = "x" in filter ? filter.y : null;
    const xr = fx && "range" in fx ? fx.range.map((v) => apply(frame!.x, v, dim.x)) : [frame.left, frame.right];
    const yr =
      fy && "range" in fy && dim.y ? fy.range.map((v) => apply(frame!.y, v, dim.y!)) : [frame.top, frame.bottom];
    showRect(clampX(xr[0]!), clampX(xr[1]!), clampY(yr[0]!), clampY(yr[1]!));
    if (mark === "streamY") shade(clampX(xr[0]!), clampX(xr[1]!));
  };

  /** Dim the frame left and right of [x0, x1]. */
  const shade = (x0: number, x1: number) => {
    if (!frame) return;
    const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const spans = [
      [frame.left, a],
      [b, frame.right],
    ] as const;
    for (const [i, r] of shades.entries()) {
      const [s, e] = spans[i]!;
      r.setAttribute("x", String(s));
      r.setAttribute("y", String(frame.top));
      r.setAttribute("width", String(Math.max(0, e - s)));
      r.setAttribute("height", String(frame.bottom - frame.top));
      r.setAttribute("visibility", e - s > 0 ? "visible" : "hidden");
    }
    brushRect.setAttribute("fill-opacity", "0");
  };

  const toIntent = (x0: number, x1: number, y0: number, y1: number): Intent | null => {
    if (!frame?.x?.invert) return null;
    const xs = sorted(invert(frame.x, x0, dim.x), invert(frame.x, x1, dim.x));
    if (brushMode === "xy" && dim.y && frame.y?.invert) {
      const ys = sorted(invert(frame.y, y0, dim.y), invert(frame.y, y1, dim.y));
      return { type: "brushXY", x: xs, y: ys };
    }
    return { type: "brush", range: xs };
  };

  const onDown = (e: PointerEvent) => {
    if (!canBrush() || e.button !== 0) return;
    const [px, py] = local(e);
    if (!inFrame(px, py)) return;
    dragging = { x0: px, y0: brushMode === "xy" ? py : frame!.top, pointer: e.pointerId };
    overlay.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.pointer) return;
    const [px, py] = local(e);
    const x1 = clampX(px);
    const y1 = brushMode === "xy" ? clampY(py) : frame!.bottom;
    if (Math.abs(x1 - dragging.x0) < MIN_DRAG && Math.abs(y1 - dragging.y0) < MIN_DRAG) return;
    showRect(dragging.x0, x1, dragging.y0, y1);
    if (mark === "streamY") shade(dragging.x0, x1);
    const intent = toIntent(dragging.x0, x1, dragging.y0, y1);
    if (intent) emit(intent);
  };

  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.pointer) return;
    const [px, py] = local(e);
    const moved =
      Math.abs(clampX(px) - dragging.x0) >= MIN_DRAG ||
      (brushMode === "xy" && Math.abs(clampY(py) - dragging.y0) >= MIN_DRAG);
    dragging = null;
    overlay.releasePointerCapture?.(e.pointerId);
    // A click without a drag clears the brush.
    if (!moved) emit({ type: "brush", range: null });
    else if (last) drawFilter(last.filter);
  };

  const onClick = (e: MouseEvent) => {
    if (!selectMode || !frame || !last) return;
    const [px, py] = local(e);
    const key =
      mark === "shareX" || mark === "bump"
        ? (nearest(targets, px, py)?.datum.key ?? null)
        : hitBand(frame, mark, px, py);
    if (key === null) return emit({ type: "reset" });
    const current = last.filter && "in" in last.filter ? last.filter.in : [];
    if (selectMode === "single") {
      emit(
        current.length === 1 && current[0] === key
          ? { type: "reset" }
          : { type: "select", keys: [key], mode: "replace" },
      );
    } else {
      emit({
        type: "select",
        keys: [key],
        mode: e.shiftKey || e.metaKey || e.ctrlKey || current.length > 0 ? "toggle" : "replace",
      });
    }
  };

  // --- hover tooltip -------------------------------------------------------
  const tooltipText = view.tooltip === false ? null : (view.tooltip ?? defaultTooltip(dim, view.format ?? formatValue));

  const hideTip = () => {
    tip.style.visibility = "hidden";
  };

  const onHover = (e: PointerEvent) => {
    if (!tooltipText || dragging || !frame || !last) return hideTip();
    const [px, py] = local(e);
    const target = targets.length ? nearest(targets, px, py) : null;
    const hit = targets.length
      ? target && { datum: target.datum, bin: target.bin ?? [target.datum] }
      : hitDatum(dim, mark, frame, last.data.data, px, py);
    if (!hit) return hideTip();
    if ((mark === "stackY" || mark === "streamY") && view.series) {
      const rank = new Map(view.series.map((k, i) => [k, i]));
      hit.bin = [...hit.bin].sort((a, b) => (rank.get(b.ykey!) ?? -1) - (rank.get(a.ykey!) ?? -1));
    }
    const lines = tooltipText(hit.datum, hit.bin).split("\n");
    tip.replaceChildren(
      ...lines.map((line, i) => {
        const div = document.createElement("div");
        div.textContent = line;
        if (i === 0) div.style.fontWeight = "600";
        return div;
      }),
    );
    tip.style.visibility = "visible";
    const top = overlay.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    const w = tip.offsetWidth;
    const left = px + 12 + w > stage.clientWidth ? px - 12 - w : px + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top + py - tip.offsetHeight - 8)}px`;
  };

  if (tooltipText) {
    overlay.addEventListener("pointermove", onHover);
    overlay.addEventListener("pointerleave", hideTip);
    overlay.addEventListener("pointerdown", hideTip);
  }

  if (brushMode) {
    overlay.style.cursor = canBrush() ? "crosshair" : "default";
    overlay.style.touchAction = "none";
    overlay.addEventListener("pointerdown", onDown);
    overlay.addEventListener("pointermove", onMove);
    overlay.addEventListener("pointerup", onUp);
    overlay.addEventListener("pointercancel", onUp);
  } else if (selectMode) {
    overlay.style.cursor = "pointer";
    overlay.addEventListener("click", onClick);
  } else if (!tooltipText) {
    overlay.style.pointerEvents = "none";
  }

  const resizeObserver =
    view.width === undefined && typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          const w = el.clientWidth;
          if (w > 0 && Math.abs(w - width) > 1) {
            width = w;
            draw();
          }
        })
      : null;
  resizeObserver?.observe(el);

  return {
    update(data, filter) {
      last = { data, filter };
      draw();
    },
    resize(w) {
      width = w;
      draw();
    },
    destroy() {
      resizeObserver?.disconnect();
      dots.clear();
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Plot figure
// ---------------------------------------------------------------------------

function isSelected(d: Datum, filter: Filter | null): boolean {
  if (!filter) return true;
  const axisIn = (f: Filter | null | undefined, key: string, x0: number, x1: number) => {
    if (!f) return true;
    if ("in" in f) return f.in.includes(key);
    if ("range" in f) return x1 > f.range[0] && x0 < f.range[1];
    return true;
  };
  if ("x" in filter)
    return axisIn(filter.x, d.key, d.x0, d.x1) && axisIn(filter.y, d.ykey ?? "", d.y0 ?? NaN, d.y1 ?? NaN);
  return axisIn(filter, d.key, d.x0, d.x1);
}

/** Scale options for a binned or categorical axis, leaving unset options out. */
function axisScale(axis: AxisInfo, label: string | null): Plot.ScaleOptions {
  const type = scaleType(axis);
  const format = tickFormat(axis);
  return { label, ...(type ? { type } : {}), ...(format ? { tickFormat: format } : {}) };
}

function scaleType(axis: AxisInfo): Plot.ScaleType | undefined {
  if (axis.kind === "category") return "band";
  if (axis.date) return "utc";
  return axis.scale === "log" ? "log" : "linear";
}

function tickFormat(axis: AxisInfo): string | undefined {
  // Years and other integer-binned values read better without thousands separators.
  if (axis.kind === "bin" && !axis.date && axis.scale !== "log" && axis.edges.every(Number.isInteger)) return "d";
  return undefined;
}

function buildPlot(
  dim: DimensionInfo,
  mark: PlotMark,
  view: PlotView,
  chart: ChartData,
  filter: Filter | null,
  width: number,
): HTMLElement | SVGSVGElement {
  const accent = view.color ?? ACCENT;
  const muted = view.mutedColor ?? MUTED;
  const fill = (d: Datum) => (isSelected(d, filter) ? (view.colors?.[d.key] ?? accent) : muted);
  const rows = chart.data as Datum[];
  const format = view.format ?? formatValue;
  const scaled = view.compare ? compareScale(rows) : null;
  const marks: Plot.Markish[] = [];
  const options: Plot.PlotOptions = { width, height: view.height ?? 200, marks };
  const valueLabel = view.yLabel === undefined ? "Count" : view.yLabel;

  if (dim.y && mark === "streamY") {
    if (dim.x.kind !== "bin" || dim.y.kind !== "category") throw new Error("streamY needs a [bin, category] grid");
    const order = view.series ?? dim.y.keys;
    const rank = new Set(order);
    const scheme = Plot.scale({ color: { type: "categorical", domain: order } });
    options.color = { domain: order, range: order.map((k) => view.colors?.[k] ?? (scheme.apply(k) as string)) };
    options.x = {
      ...axisScale(dim.x, orDefault(view.xLabel, dim.x.field)),
      domain: [dim.x.edges[0]!, dim.x.edges[dim.x.size]!],
    };
    options.y = { axis: null };
    const mid = (d: Datum) => (dim.x.scale === "log" ? Math.sqrt(d.x0 * d.x1) : (d.x0 + d.x1) / 2);
    marks.push(
      Plot.areaY(
        rows.filter((d) => rank.has(d.ykey ?? "")),
        {
          x: mid,
          y: (d: Datum) => (Number.isNaN(d.value) ? 0 : d.value),
          z: "ykey",
          fill: "ykey",
          order: [...order],
          offset: "center",
          curve: "basis",
        },
      ),
    );
  } else if (dim.y && mark === "bump") {
    if (dim.x.kind !== "category" || dim.y.kind !== "category")
      throw new Error("bump needs a [category, category] grid");
    const { lines, periods, points } = bumpPoints(dim, rows, view);
    // With `colors`, only the named lines stand out until something is selected.
    const quiet = (key: string) => filter === null && view.colors !== undefined && !view.colors[key];
    const color = (key: string) =>
      quiet(key)
        ? "currentColor"
        : filter === null || isSelected(points.find((p) => p.key === key)!, filter)
          ? (view.colors?.[key] ?? accent)
          : muted;
    const on = (d: Datum) => filter !== null && isSelected(d, filter);
    options.height = view.height ?? Math.max(160, lines.length * 26 + 40);
    options.x = { domain: periods, type: "point", label: null, axis: "top", tickSize: 0, padding: 0.1 };
    options.y = { domain: [0.5, lines.length + 0.5], reverse: true, axis: null };
    options.marginLeft = view.plot?.marginLeft ?? 100;
    options.marginRight = view.plot?.marginRight ?? 100;
    const ranked = points.filter((p) => !Number.isNaN(p.rank));
    const ends = (pick: "first" | "last") => {
      const out = new Map<string, Ranked>();
      const n = new Map<string, number>();
      for (const p of ranked) {
        n.set(p.key, (n.get(p.key) ?? 0) + 1);
        if (pick === "last" || !out.has(p.key)) out.set(p.key, p);
      }
      // A line with a single point gets one label, on the right.
      return [...out.values()].filter((p) => pick === "last" || n.get(p.key)! > 1);
    };
    // Unselected lines first, so the picked ones draw on top.
    const layered = [...ranked].sort(
      (a, b) => Number(on(a)) - Number(on(b)) || Number(quiet(b.key)) - Number(quiet(a.key)),
    );
    marks.push(
      Plot.line(layered, {
        x: "ykey",
        y: "rank",
        z: "key",
        stroke: (d: Ranked) => color(d.key),
        strokeWidth: (d: Ranked) => (on(d) ? 3 : 1.75),
        strokeOpacity: (d: Ranked) => (quiet(d.key) ? 0.3 : filter === null ? 0.85 : on(d) ? 1 : 0.5),
        curve: "bump-x",
      }),
      Plot.dot(layered, {
        x: "ykey",
        y: "rank",
        fill: (d: Ranked) => color(d.key),
        fillOpacity: (d: Ranked) => (quiet(d.key) ? 0.45 : 1),
        r: (d: Ranked) => (on(d) ? 4.5 : 3),
      }),
      ...(["first", "last"] as const).map((pick) =>
        Plot.text(ends(pick), {
          x: "ykey",
          y: "rank",
          text: "key",
          textAnchor: pick === "first" ? "end" : "start",
          dx: pick === "first" ? -9 : 9,
          fill: "currentColor",
          fillOpacity: (d: Ranked) => (filter === null || on(d) ? 1 : 0.6),
          fontWeight: 500,
        }),
      ),
    );
  } else if (!dim.y && mark === "shareX") {
    if (dim.x.kind !== "category") throw new Error("shareX needs a category dimension");
    const segments = shareSegments(dim, rows, view);
    const fits = (s: Segment) => (s.x2 - s.x1) * width >= s.label.length * 7 + 14;
    const outside = segments.filter((s) => !fits(s));
    options.height = view.height ?? (outside.length > 1 ? 80 : outside.length ? 66 : 48);
    options.marginTop = 6;
    options.marginBottom = outside.length > 1 ? 38 : outside.length ? 24 : 6;
    options.marginLeft = 0;
    options.marginRight = 0;
    options.x = { domain: [0, 1], axis: null };
    options.y = { domain: [0, 1], axis: null };
    const selected = (s: Segment) => isSelected(s.datum, filter);
    marks.push(
      Plot.rectX(segments, {
        x1: "x1",
        x2: "x2",
        y1: 0,
        y2: 1,
        fill: (s: Segment) => fill(s.datum),
        insetRight: 1,
      }),
      ...[true, false].map((on) =>
        Plot.text(
          segments.filter((s) => fits(s) && selected(s) === on),
          {
            x: "x1",
            y: 0.5,
            dx: 8,
            text: "label",
            textAnchor: "start",
            fill: on ? "white" : "currentColor",
            fontWeight: 500,
          },
        ),
      ),
      // Labels that don't fit go under the bar, alternating rows so neighbors don't collide.
      // Near the right end they hang left from the segment's end so they aren't cut off.
      ...[0, 1].flatMap((row) =>
        (["middle", "end"] as const).map((anchor) =>
          Plot.text(
            outside.filter((s, i) => i % 2 === row && (s.x1 + s.x2 > 1.6 ? "end" : "middle") === anchor),
            {
              x: (s: Segment) => (anchor === "end" ? s.x2 : (s.x1 + s.x2) / 2),
              y: 0,
              dy: 12 + row * 12,
              text: "label",
              textAnchor: anchor,
              fill: "currentColor",
              fontSize: 11,
            },
          ),
        ),
      ),
    );
    const scaled = compareScale(rows);
    if (scaled) {
      const base = shareSegments(dim, rows, view, true);
      marks.push(Plot.ruleX(base.slice(0, -1), { x: "x2", y1: -0.15, y2: 1.15, ...COMPARE }));
    }
  } else if (dim.y && mark === "stackY") {
    if (dim.x.kind !== "bin" || dim.y.kind !== "category") throw new Error("stackY needs a [bin, category] grid");
    const order = view.series ?? dim.y.keys;
    const rank = new Map(order.map((k, i) => [k, i]));
    const stacked = stack(rows, dim.y.size, rank);
    const scheme = Plot.scale({ color: { type: "categorical", domain: order } });
    options.color = { domain: order, range: order.map((k) => view.colors?.[k] ?? (scheme.apply(k) as string)) };
    options.x = {
      ...axisScale(dim.x, orDefault(view.xLabel, dim.x.field)),
      domain: [dim.x.edges[0]!, dim.x.edges[dim.x.size]!],
    };
    options.y = { label: valueLabel, grid: true };
    marks.push(
      Plot.rect(stacked, {
        x1: "x0",
        x2: "x1",
        y1: "lo",
        y2: "hi",
        fill: "ykey",
        fillOpacity: (d: Datum) => (isSelected(d, filter) ? 1 : 0.25),
        insetLeft: dim.x.size > 120 ? 0 : 0.5,
        insetRight: dim.x.size > 120 ? 0 : 0.5,
      }),
      Plot.ruleY([0]),
    );
  } else if (dim.y) {
    const opacity = (d: Datum) => (isSelected(d, filter) ? 1 : 0.25);
    const visible = rows.filter((d) => d.count > 0);
    options.height = view.height ?? 300;
    options.color = { type: "sqrt", scheme: (view.scheme ?? "blues") as Plot.ColorScheme, label: "Count" };
    options.x = axisScale(dim.x, orDefault(view.xLabel, dim.x.field));
    options.y = axisScale(dim.y, orDefault(view.yLabel, dim.y.field));
    if (mark === "cell" || dim.x.kind === "category" || dim.y.kind === "category") {
      if (dim.x.kind === "category") options.x = { ...options.x, domain: dim.x.keys };
      if (dim.y.kind === "category") options.y = { ...options.y, domain: dim.y.keys };
      marks.push(
        Plot.cell(visible, {
          x: dim.x.kind === "category" ? "key" : "x0",
          y: dim.y.kind === "category" ? "ykey" : "y0",
          fill: "value",
          fillOpacity: opacity,
          tip: true,
        }),
      );
    } else {
      options.x = { ...options.x, domain: [dim.x.edges[0]!, dim.x.edges[dim.x.size]!] };
      options.y = { ...options.y, domain: [dim.y.edges[0]!, dim.y.edges[dim.y.size]!] };
      marks.push(
        Plot.rect(visible, {
          x1: "x0",
          x2: "x1",
          y1: "y0",
          y2: "y1",
          fill: "value",
          fillOpacity: opacity,
          inset: 0,
          title: (d: Datum) => `${dim.x.field} ${d.key}\n${dim.y!.field} ${d.ykey}\n${d.value.toLocaleString("en-US")}`,
        }),
      );
    }
  } else if (dim.x.kind === "category") {
    const keys = categoryOrder(dim, rows, view.sort ?? "key").filter((k) => !view.omit?.includes(k));
    const shown = view.omit ? rows.filter((d) => !view.omit!.includes(d.key)) : rows;
    if (mark === "barY") {
      options.x = { domain: keys, label: view.xLabel ?? null, tickRotate: keys.length > 8 ? -45 : 0 };
      options.y = { label: valueLabel, grid: true };
      if (keys.length > 8) options.marginBottom = 70;
      marks.push(Plot.barY(shown, { x: "key", y: "value", fill }), Plot.ruleY([0]));
      if (scaled) marks.push(Plot.tickY(shown, { x: "key", y: (d: Datum) => d.baseline * scaled, ...COMPARE }));
    } else {
      options.height = view.height ?? Math.max(60, keys.length * 22 + 40);
      options.y = { domain: keys, label: view.xLabel ?? null };
      options.x = { label: valueLabel, grid: true };
      options.marginLeft = view.plot?.marginLeft ?? Math.min(160, 12 + 7 * Math.max(...keys.map((k) => k.length)));
      marks.push(Plot.barX(shown, { y: "key", x: "value", fill }), Plot.ruleX([0]));
      if (scaled) marks.push(Plot.tickX(shown, { y: "key", x: (d: Datum) => d.baseline * scaled, ...COMPARE }));
      if (view.labels) {
        options.marginRight = view.plot?.marginRight ?? 56;
        marks.push(
          Plot.text(shown, {
            y: "key",
            x: (d: Datum) => Math.max(d.value || 0, scaled ? d.baseline * scaled : 0),
            text: (d: Datum) => format(d.value),
            textAnchor: "start",
            dx: 5,
            fill: "currentColor",
          }),
        );
      }
    }
  } else {
    options.x = {
      ...axisScale(dim.x, orDefault(view.xLabel, dim.x.field)),
      domain: [dim.x.edges[0]!, dim.x.edges[dim.x.size]!],
    };
    options.y = { label: valueLabel, grid: true };
    if (mark === "line" || mark === "areaY") {
      const mid = (d: Datum) => (dim.x.scale === "log" ? Math.sqrt(d.x0 * d.x1) : (d.x0 + d.x1) / 2);
      if (mark === "areaY") marks.push(Plot.areaY(rows, { x: mid, y: "value", fill: accent, fillOpacity: 0.2 }));
      marks.push(Plot.lineY(rows, { x: mid, y: "value", stroke: accent }));
    } else {
      marks.push(Plot.rectY(rows, { x1: "x0", x2: "x1", y: "value", fill, insetLeft: 0.5, insetRight: 0.5 }));
      if (scaled) {
        const steps = rows.flatMap((d) => [
          { x: d.x0, y: d.baseline * scaled },
          { x: d.x1, y: d.baseline * scaled },
        ]);
        marks.push(Plot.line(steps, { x: "x", y: "y", ...COMPARE }));
      }
    }
    marks.push(Plot.ruleY([0]));
  }

  if (view.reverse && options.x) options.x = { ...options.x, reverse: true };
  // Scale options in view.plot refine the computed ones instead of replacing them.
  const scales = Object.fromEntries(
    (["x", "y", "color"] as const)
      .filter((k) => view.plot?.[k])
      .map((k) => [k, { ...(options[k] as object), ...(view.plot![k] as object) }]),
  );
  return Plot.plot({
    ...options,
    ...view.plot,
    ...scales,
    marks: [...(view.underlay ?? []), ...marks, ...((view.plot?.marks as Plot.Markish[]) ?? [])],
  });
}

const COMPARE = { stroke: "currentColor", strokeOpacity: 0.7, strokeWidth: 1.5, strokeDasharray: "3,2" } as const;

/** `null` means "no label"; only `undefined` falls back. */
function orDefault(label: string | null | undefined, fallback: string): string | null {
  return label === undefined ? fallback : label;
}

function formatValue(v: number): string {
  return Number.isNaN(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Factor that scales the unfiltered baseline to the current total, or null when there is nothing to compare. */
function compareScale(rows: readonly Datum[]): number | null {
  let value = 0;
  let base = 0;
  for (const d of rows) {
    if (!Number.isNaN(d.value)) value += d.value;
    if (!Number.isNaN(d.baseline)) base += d.baseline;
  }
  // Nothing filtered (or no baseline): the outline would sit on the bars.
  if (!(base > 0) || Math.abs(value - base) < 1e-9 * base) return null;
  return value / base;
}

type Stacked = Datum & { readonly lo: number; readonly hi: number };

/** Stack a [bin, category] grid's values per x bin, in series order. */
function stack(rows: readonly Datum[], ySize: number, rank: ReadonlyMap<string, number>): Stacked[] {
  const out: Stacked[] = [];
  for (let i = 0; i < rows.length; i += ySize) {
    const bin = rows.slice(i, i + ySize).filter((d) => rank.has(d.ykey ?? ""));
    bin.sort((a, b) => rank.get(a.ykey!)! - rank.get(b.ykey!)!);
    let lo = 0;
    for (const d of bin) {
      const v = Number.isNaN(d.value) ? 0 : d.value;
      if (v > 0) out.push({ ...d, lo, hi: lo + v });
      lo += v;
    }
  }
  return out;
}

function defaultTooltip(dim: DimensionInfo, format: (v: number) => string) {
  return (d: Datum, bin: readonly Datum[]): string => {
    if (dim.y && bin.length > 1) return [d.key, ...bin.map((b) => `${b.ykey}: ${format(b.value)}`)].join("\n");
    if (dim.y) return `${d.key} × ${d.ykey}\n${format(d.value)}`;
    return `${d.key}\n${format(d.value)}`;
  };
}

function binAt(axis: AxisInfo, v: number): number {
  const e = axis.edges;
  if (!(v >= e[0]!) || !(v < e[axis.size]!)) return -1;
  let lo = 0;
  let hi = axis.size;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (e[mid]! <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The datum under a pointer, plus its whole x bin for stacked charts. */
function hitDatum(
  dim: DimensionInfo,
  mark: PlotMark,
  frame: Frame,
  data: readonly Datum[],
  px: number,
  py: number,
): { datum: Datum; bin: Datum[] } | null {
  if (px < frame.left || px > frame.right || py < frame.top || py > frame.bottom) return null;
  if (dim.x.kind === "category" && !dim.y) {
    const key = hitBand(frame, mark, px, py);
    const d = key === null ? undefined : data.find((r) => r.key === key);
    return d ? { datum: d, bin: [d] } : null;
  }
  if (dim.x.kind !== "bin" || !frame.x?.invert) return null;
  const i = binAt(dim.x, invert(frame.x, px, dim.x));
  if (i < 0) return null;
  if (!dim.y) return data[i] ? { datum: data[i]!, bin: [data[i]!] } : null;
  const ys = dim.y.size;
  const bin = data.slice(i * ys, i * ys + ys);
  if (mark === "stackY" || mark === "streamY")
    return bin.length ? { datum: bin[0]!, bin: bin.filter((d) => d.value > 0) } : null;
  if (dim.y.kind !== "bin" || !frame.y?.invert) return null;
  const j = binAt(dim.y, invert(frame.y, py, dim.y));
  return j < 0 ? null : { datum: bin[j]!, bin: [bin[j]!] };
}

function categoryOrder(dim: DimensionInfo, rows: readonly Datum[], sort: NonNullable<PlotView["sort"]>): string[] {
  if (sort === "key") return [...dim.x.keys];
  const dir = sort.startsWith("-") ? -1 : 1;
  const by = sort.endsWith("baseline") ? (d: Datum) => d.baseline || 0 : (d: Datum) => d.value || 0;
  return [...rows].sort((a, b) => dir * (by(a) - by(b)) || a.index - b.index).map((d) => d.key);
}

// ---------------------------------------------------------------------------
// Maps, share bars and bump charts
// ---------------------------------------------------------------------------

/** The plate carrée frame of a map: x and y scales on the grid's extent, no axes. */
function buildMap(
  dim: DimensionInfo,
  view: PlotView,
  underlay: readonly Plot.Markish[],
  width: number,
): HTMLElement | SVGSVGElement {
  if (dim.x.kind !== "bin" || dim.y?.kind !== "bin") throw new Error("map needs a [bin, bin] grid, e.g. lngLat()");
  const xDomain = [dim.x.edges[0]!, dim.x.edges[dim.x.size]!];
  const yDomain = [dim.y.edges[0]!, dim.y.edges[dim.y.size]!];
  return Plot.plot({
    width,
    aspectRatio: 1,
    margin: 0,
    x: { domain: xDomain, axis: null },
    y: { domain: yDomain, axis: null },
    ...view.plot,
    marks: [
      ...underlay,
      // An empty mark so the x and y scales exist even without an underlay.
      Plot.dot([] as number[][], { x: (d: number[]) => d[0], y: (d: number[]) => d[1] }),
      ...((view.plot?.marks as Plot.Markish[]) ?? []),
    ],
  });
}

interface Segment {
  readonly datum: Datum;
  readonly x1: number;
  readonly x2: number;
  readonly label: string;
}

/** A category dimension as consecutive shares of one bar, in the view's sort order. */
function shareSegments(dim: DimensionInfo, rows: readonly Datum[], view: PlotView, baseline = false): Segment[] {
  const keys = categoryOrder(dim, rows, view.sort ?? "key").filter((k) => !view.omit?.includes(k));
  const byKey = new Map(rows.map((d) => [d.key, d]));
  const v = (d: Datum) => {
    const x = baseline ? d.baseline : d.value;
    return Number.isNaN(x) ? 0 : x;
  };
  let total = 0;
  for (const k of keys) total += v(byKey.get(k)!);
  let acc = 0;
  return keys.map((k) => {
    const d = byKey.get(k)!;
    const x1 = total > 0 ? acc / total : 0;
    acc += v(d);
    const x2 = total > 0 ? acc / total : 0;
    return { datum: d, x1, x2, label: `${k} ${Math.round((x2 - x1) * 100)}%` };
  });
}

type Ranked = Datum & { readonly rank: number };

/** Rank the x keys (lines) within each y key (period) by value; empty cells have no rank. */
function bumpPoints(dim: DimensionInfo, rows: readonly Datum[], view: PlotView) {
  const omit = new Set(view.omit ?? []);
  const lines = dim.x.keys.filter((k) => !omit.has(k));
  const periods = dim.y!.keys.filter((k) => !omit.has(k));
  const points: Ranked[] = [];
  const ys = dim.y!.size;
  for (const [j, period] of dim.y!.keys.entries()) {
    if (omit.has(period)) continue;
    const column = lines
      .map((k) => rows[dim.x.keys.indexOf(k) * ys + j]!)
      .sort((a, b) => (b.value || 0) - (a.value || 0) || a.index - b.index);
    let r = 0;
    for (const d of column) points.push({ ...d, rank: d.value > 0 ? ++r : Number.NaN });
  }
  return { lines, periods, points };
}

/** Something the pointer can hit: a dot (x, y, r) or a span of x across the frame. */
interface Target {
  readonly datum: Datum;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly span?: readonly [number, number];
  readonly bin?: readonly Datum[];
}

function hitTargets(
  dim: DimensionInfo,
  mark: PlotMark,
  view: PlotView,
  frame: Frame,
  rows: readonly Datum[],
): Target[] {
  if (mark === "shareX" && frame.x) {
    const x = frame.x;
    return shareSegments(dim, rows, view).map((s) => ({
      datum: s.datum,
      x: 0,
      y: (frame.top + frame.bottom) / 2,
      r: (frame.bottom - frame.top) / 2,
      span: [x.apply(s.x1) as number, x.apply(s.x2) as number],
    }));
  }
  if (mark === "bump" && frame.x && frame.y) {
    const { points } = bumpPoints(dim, rows, view);
    return points
      .filter((p) => !Number.isNaN(p.rank))
      .map((p) => ({ datum: p, x: frame.x!.apply(p.ykey) as number, y: frame.y!.apply(p.rank) as number, r: 12 }));
  }
  return [];
}

/** The target under or closest to a point, if it is within reach. */
function nearest(targets: readonly Target[], px: number, py: number): Target | null {
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (t.span) {
      if (px >= t.span[0] && px <= t.span[1] && Math.abs(py - t.y) <= t.r) return t;
      continue;
    }
    const d = Math.hypot(px - t.x, py - t.y);
    if (d <= t.r + 4 && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function svgEl<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function readFrame(plot: Plot.Plot, svg: SVGSVGElement): Frame {
  const x = plot.scale("x");
  const y = plot.scale("y");
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  const xr = (x?.range as number[] | undefined) ?? [0, w];
  const yr = (y?.range as number[] | undefined) ?? [h, 0];
  return {
    x,
    y,
    left: Math.min(xr[0]!, xr[1]!),
    right: Math.max(xr[0]!, xr[1]!),
    top: Math.min(yr[0]!, yr[1]!),
    bottom: Math.max(yr[0]!, yr[1]!),
  };
}

function apply(scale: Scale | undefined, v: number, axis: AxisInfo): number {
  if (!scale) return Number.NaN;
  return scale.apply(axis.date ? new Date(v) : v) as number;
}

function invert(scale: Scale, px: number, axis: AxisInfo): number {
  const v = scale.invert!(px) as number | Date;
  const n = v instanceof Date ? v.getTime() : v;
  // Snap to the extent so a brush dragged past the edge covers the edge bin.
  const lo = axis.edges[0]!;
  const hi = axis.edges[axis.size]!;
  return Math.min(hi + (hi - lo) * 1e-9, Math.max(lo, n));
}

function sorted(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** The category under a click, from the band scale. */
function hitBand(frame: Frame, mark: PlotMark, px: number, py: number): string | null {
  const vertical = mark === "barY";
  const scale = vertical ? frame.x : frame.y;
  if (!scale?.bandwidth || !scale.domain) return null;
  const pos = vertical ? px : py;
  const other = vertical ? py : px;
  if (vertical ? other < frame.top || other > frame.bottom : other < frame.left || other > frame.right) return null;
  for (const key of scale.domain as string[]) {
    const start = scale.apply(key) as number;
    if (pos >= start && pos <= start + scale.bandwidth) return key;
  }
  return null;
}
