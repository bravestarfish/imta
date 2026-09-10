import { describe, it, expect } from "vitest";
import { normalize, intersect, subtract, union, atLeast, pad, intersectAll } from "./intervals";

const iv = (s: number, e: number) => ({ start: s, end: e });

describe("intervals", () => {
  it("normalizes and merges overlapping/adjacent intervals", () => {
    expect(normalize([iv(5, 10), iv(0, 5), iv(12, 14), iv(13, 20), iv(30, 30)])).toEqual([iv(0, 10), iv(12, 20)]);
  });

  it("intersects two sets", () => {
    expect(intersect([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(5, 10), iv(20, 25)]);
    expect(intersect([iv(0, 10)], [iv(10, 20)])).toEqual([]);
  });

  it("intersects many sets", () => {
    expect(intersectAll([[iv(0, 10)], [iv(2, 8)], [iv(4, 12)]])).toEqual([iv(4, 8)]);
    expect(intersectAll([])).toEqual([]);
  });

  it("subtracts", () => {
    expect(subtract([iv(0, 100)], [iv(10, 20), iv(30, 40)])).toEqual([iv(0, 10), iv(20, 30), iv(40, 100)]);
    expect(subtract([iv(0, 10)], [iv(-5, 15)])).toEqual([]);
    expect(subtract([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(0, 5), iv(25, 30)]);
  });

  it("unions", () => {
    expect(union([iv(0, 5)], [iv(3, 8)], [iv(10, 12)])).toEqual([iv(0, 8), iv(10, 12)]);
  });

  it("pads", () => {
    expect(pad([iv(10, 20)], 5, 3)).toEqual([iv(5, 23)]);
  });

  it("computes threshold coverage", () => {
    const a = [iv(0, 10)];
    const b = [iv(5, 15)];
    const c = [iv(8, 20)];
    expect(atLeast([a, b, c], 1)).toEqual([iv(0, 20)]);
    expect(atLeast([a, b, c], 2)).toEqual([iv(5, 15)]);
    expect(atLeast([a, b, c], 3)).toEqual([iv(8, 10)]);
    expect(atLeast([a, b, c], 4)).toEqual([]);
  });
});
