import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useStarting from "./useStarting";

describe("useStarting", () => {
  it("starts empty, takes a starting value that arrives later, and never overwrites what the person did", () => {
    const { result, rerender } = renderHook(({ s }) => useStarting(s), { initialProps: { s: undefined } });
    expect(result.current[0]).toBe("");
    rerender({ s: "from-lab" });
    expect(result.current[0]).toBe("from-lab");
    act(() => result.current[1]("typed"));
    rerender({ s: "newer-from-lab" });
    expect(result.current[0]).toBe("typed");
  });
  it("a person who clears the box keeps it cleared", () => {
    const { result, rerender } = renderHook(({ s }) => useStarting(s), { initialProps: { s: "a" } });
    expect(result.current[0]).toBe("a");
    act(() => result.current[1](""));
    rerender({ s: "a2" });
    expect(result.current[0]).toBe("");
  });
});
