import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LineDetail, { parseFields } from "./LineDetail";

describe("parseFields", () => {
  it("reads key=value pairs, including quoted values with escapes", () => {
    const r = parseFields('level=info msg="authorization header missing" note="a \\"b\\" c"');
    expect(r.kind).toBe("pairs");
    expect(r.pairs).toEqual([["level", "info"], ["msg", "authorization header missing"], ["note", 'a "b" c']]);
  });
  it("reads a JSON object", () => {
    expect(parseFields('{"msg":"AIGuard","Category":"prompt_injection"}')).toEqual({ kind: "json", value: { msg: "AIGuard", Category: "prompt_injection" } });
  });
  it("finds nothing in plain text, a single pair, or broken JSON, and never throws", () => {
    expect(parseFields("exec    pid=4200  python           host")).toBeNull();
    expect(parseFields("just words")).toBeNull();
    expect(parseFields("{not json")).toBeNull();
    expect(parseFields(undefined)).toBeNull();
  });
  it("stops at 40 pairs", () => {
    const line = Array.from({ length: 100 }, (_, i) => `k${i}=v`).join(" ");
    expect(parseFields(line).pairs).toHaveLength(40);
  });
});

describe("LineDetail", () => {
  const story = { products: [{ service: "svc", sources: [{ id: "src", title: "A kind of line", where: "Where it comes from", status: "measured", note: "A note." }] }] };
  const entry = { id: "e1", ts: "2026-11-07T12:00:01.000Z", product: "p", source: "src", level: "info", service: "svc", message: 'level=info msg="hello <b>x</b>"', traceId: null };
  it("shows time, labels, the whole message, its fields and what kind of line it is, all as text", () => {
    const { container } = render(<LineDetail entry={entry} story={story} />);
    const d = screen.getByTestId("line-detail");
    expect(within(d).getByText("2026-11-07T12:00:01.000Z")).toBeInTheDocument();
    expect(within(d).getByText("service=svc")).toBeInTheDocument();
    expect(within(d).getByText("A kind of line")).toBeInTheDocument();
    expect(within(d).getByText("measured")).toBeInTheDocument();
    expect(within(d).getByText("msg")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
  it("shows no kind-of-line section for a line it does not know, and a trace button when there is a trace id", () => {
    render(<LineDetail entry={{ ...entry, source: "other", traceId: "a".repeat(32) }} story={story} onTrace={() => {}} />);
    expect(screen.queryByText("What this line is")).toBeNull();
    expect(screen.getByRole("button", { name: "search this trace" })).toBeInTheDocument();
  });
});
