import { FilterStore } from "@crossplot/core";
import { describe, expect, it, vi } from "vitest";

describe("FilterStore", () => {
  it("versions every change and skips no-ops", () => {
    const s = new FilterStore();
    const seen: number[] = [];
    s.subscribe((snap) => seen.push(snap.version));
    s.set("a", { range: [0, 1] });
    s.set("a", { range: [0, 1] }); // same value: no change
    s.set("b", { in: ["x"] });
    s.clear("a");
    s.clear("a"); // already clear
    s.clear();
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(s.snapshot.filters).toEqual({});
  });

  it("keeps old snapshots immutable and copies input", () => {
    const s = new FilterStore();
    const input = { in: ["x"] };
    s.set("a", input);
    const before = s.snapshot;
    input.in.push("y");
    s.set("b", { range: [1, 2] });
    expect(before.filters).toEqual({ a: { in: ["x"] } });
    expect(Object.isFrozen(s.snapshot.filters)).toBe(true);
    expect(() => (s.get("a") as { in: string[] }).in.push("z")).toThrow();
  });

  it("round-trips through JSON", () => {
    const a = new FilterStore();
    a.set("year", { range: [1900, 1950] });
    a.set("grid", { x: { range: [0, 1] }, y: null });
    const json = JSON.stringify(a.snapshot);
    const b = new FilterStore();
    const listener = vi.fn();
    b.subscribe(listener);
    b.replace(JSON.parse(json));
    expect(b.snapshot.filters).toEqual(a.snapshot.filters);
    b.replace(JSON.parse(json));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
