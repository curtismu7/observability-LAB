import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { BANNER_UNKNOWN } from "./App";
import { labelOffsets } from "./components/PatternDiagram";

const STORY = {
  title: "t", intro: "intro text", banner: "SIMULATED: mock logs", realBanner: "REAL (read-only): your Loki", relabelRule: 'regex = "/(?:obs-demo-)?(.*)"', verticals: ["retail", "health"],
  products: [{ id: "pingfederate", name: "PingFederate", service: "pingfederate", container: "/obs-demo-pingfederate", how: "A container.", sources: [{ id: "audit.log", title: "Audit log", where: "w", status: "UNVERIFIED", sample: "AUTHN_ATTEMPT FAILURE", note: "n" }] }],
  scenarios: [
    { id: "follow-a-signin", title: "Follow one sign-in", query: '{service="pingfederate"} |= "x"', action: null, lesson: "One id is the join." },
    { id: "login-burst", title: "A burst of failed sign-ins", query: '{service="pingfederate"} |= "FAILURE"', action: { kind: "incident", name: "login-burst" }, lesson: "Eight in two minutes." },
    { id: "everything-went-quiet", title: "Everything went quiet", query: '{service="pingfederate"}', action: { kind: "relabel", enabled: false }, lesson: "Silent." },
  ],
  facts: [{ id: "f1", status: "measured", text: "A measured fact." }, { id: "f2", status: "UNVERIFIED", text: "Shapes are illustrative." }],
  talkTrack: [{ id: "say-first", title: "Say first", say: "Everything is simulated." }, { id: "burst", title: "A burst", say: "Press Simulate burst." }, { id: "silence", title: "The silent failure", say: "Turn the rule off." }],
};
const DIAGRAM = {
  title: "Log pipeline", intro: "diagram intro",
  nodes: [{ id: "pf", label: "PingFederate container", kind: "product", x: 0, y: 0 }, { id: "alloy", label: "Collector: discover + relabel to service", kind: "pipeline", x: 300, y: 0 }],
  steps: [{ from: "pf", to: "alloy", label: "stdout", say: "The collector reads stdout." }, { from: "alloy", to: "pf", label: "back", say: "n" }],
};
const hop = (n) => ({ n, from: "browser", to: "lab", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "200 OK" });
const entry = (i, over = {}) => ({ id: `e${i}`, ts: `2026-11-07T12:00:0${i}.000Z`, product: "pingfederate", source: "audit.log", level: "warn", service: "pingfederate", message: `AUTHN_ATTEMPT FAILURE user=u${i}`, traceId: null, ...over });

let calls; let override; let state;
function mockFetch() {
  calls = [];
  state = { mode: "mock", realAvailable: true, relabel: true, burst: false };
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const custom = override[url.split("?")[0]];
    if (custom) return custom(url, opts);
    if (url.startsWith("/api/scenarios")) return json(STORY);
    if (url === "/api/info") return json({ mode: state.mode, source: state.mode, simulated: state.mode === "mock", realAvailable: state.realAvailable, realHint: state.realAvailable ? null : "Real needs OBS_LOKI_URL" });
    if (url === "/api/mode") {
      const b = JSON.parse(opts.body);
      if (b.source === "real" && !state.realAvailable) return json({ error: "real_not_configured", detail: "Real needs OBS_LOKI_URL" }, 409);
      state.mode = b.source; return json({ source: b.source });
    }
    if (url.startsWith("/api/diagram")) return json(DIAGRAM);
    if (url.startsWith("/api/logs")) {
      const q = decodeURIComponent(new URL(url, "http://x").searchParams.get("query"));
      if (q === "junk") return json({ error: "bad_query", detail: "a query starts with a label selector" }, 400);
      const quiet = state.mode === "mock" && !state.relabel && q.includes("service");
      const entries = quiet ? [] : [entry(1), entry(2, { level: "info", product: "pinggateway", service: "ping-gateway", message: "route=/mcp status=200", traceId: "b".repeat(32) }), ...(state.burst ? [entry(3)] : [])];
      return json({ source: state.mode, query: q, count: entries.length, truncated: false, entries, relabel: state.relabel, traceId: "a".repeat(32), hops: [hop(1), hop(2)] });
    }
    if (url === "/api/relabel" && opts.method === "POST") { state.relabel = JSON.parse(opts.body).enabled; return json({ enabled: state.relabel }); }
    if (url === "/api/relabel") return json({ enabled: state.relabel, rule: "r" });
    if (url === "/api/incident") {
      if (state.mode === "real") return json({ error: "mock_only", detail: "This control changes the mock stream. Switch to Mock to use it." }, 409);
      state.burst = true; return json({ injected: JSON.parse(opts.body).name });
    }
    if (url === "/api/alerts") {
      return json({ source: state.mode, rules: [
        { id: "FailedLoginBurst", title: "Failed sign-in burst", lesson: "l", state: state.burst ? "firing" : "ok", summary: state.burst ? "8 failed sign-ins" : "1 failed sign-ins", evidence: { failures: 1 }, query: "{service=\"pingfederate\"}" },
        { id: "ProductLogSilence", title: "A product went quiet", lesson: "l", state: !state.relabel ? "firing" : "ok", summary: !state.relabel ? "No lines in 10 minutes for: pingfederate" : "fine", evidence: {}, query: "q" },
      ] });
    }
    if (url === "/api/reset") { state.relabel = true; state.burst = false; return json({ reset: "ok" }); }
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = ""; });
const ready = async () => { render(<App />); await screen.findByText("Follow one sign-in"); await screen.findByTestId("log-table"); };

describe("log lines open on click", () => {
  it("a line expands to show its details and collapses again; the table keeps its rows", async () => {
    const user = userEvent.setup();
    await ready();
    const rows = screen.getAllByTestId("log-row");
    expect(screen.queryByTestId("line-detail")).toBeNull();
    expect(rows[0]).toHaveAttribute("aria-expanded", "false");
    await user.click(rows[0]);
    const detail = await screen.findByTestId("line-detail");
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(within(detail).getByText("Audit log")).toBeInTheDocument();
    expect(within(detail).getByText("service=pingfederate")).toBeInTheDocument();
    await user.click(rows[0]);
    expect(screen.queryByTestId("line-detail")).toBeNull();
    expect(screen.getAllByTestId("log-row")).toHaveLength(rows.length);
  });

  it("the keyboard opens it too (Enter), and several can be open at once", async () => {
    const user = userEvent.setup();
    await ready();
    const rows = screen.getAllByTestId("log-row");
    rows[0].focus();
    await user.keyboard("{Enter}");
    await user.click(rows[1]);
    expect(screen.getAllByTestId("line-detail")).toHaveLength(2);
  });

  it("the trace button inside a line runs a trace search and does not open or close the line", async () => {
    const user = userEvent.setup();
    await ready();
    const before = calls.length;
    await user.click(screen.getAllByRole("button", { name: "trace" })[0]);
    expect(screen.queryByTestId("line-detail")).toBeNull();
    await waitFor(() => expect(calls.slice(before).some((c) => decodeURIComponent(c.url).includes("b".repeat(32)))).toBe(true));
  });
});

describe("shell and rule 19 toggle", () => {
  it("shows the banner first, the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
    expect(calls.find((c) => c.url.startsWith("/api/logs")).opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("the toggle reflects the mode (aria-pressed), switches both ways without a reload, and reloads the data", async () => {
    await ready();
    const mock = screen.getByTestId("mode-mock"); const real = screen.getByTestId("mode-real");
    expect(mock).toHaveAttribute("aria-pressed", "true"); expect(real).toHaveAttribute("aria-pressed", "false");
    const before = calls.filter((c) => c.url.startsWith("/api/logs")).length;
    await userEvent.click(real);
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real"));
    expect(screen.getByTestId("banner")).toHaveTextContent(/^REAL/);
    expect(screen.getByTestId("mode-real")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/logs")).length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("REAL Loki"));
    await userEvent.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock"));
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
  });
  it("Real is disabled with the how-to reason when not configured", async () => {
    state.realAvailable = false;
    await ready();
    const real = screen.getByTestId("mode-real");
    expect(real).toBeDisabled();
    expect(real).toHaveAttribute("title", expect.stringContaining("OBS_LOKI_URL"));
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
  });
  it("Reset calls /api/reset", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/reset" && c.opts.method === "POST")).toBe(true));
  });
});

describe("logs tab", () => {
  it("renders lines as inert text, filters by product and level, shows the count and hops", async () => {
    override["/api/logs"] = async () => ({ ok: true, status: 200, json: async () => ({ source: "mock", query: "q", count: 2, truncated: false, relabel: true, traceId: "a".repeat(32), hops: [hop(1), hop(2)], entries: [entry(1, { message: "<img src=x onerror=alert(1)> ‮ hidden" }), entry(2, { level: "info", product: "pinggateway", service: "ping-gateway", message: "ok" })] }) });
    await ready();
    const table = screen.getByTestId("log-table");
    expect(table.querySelector("img")).toBeNull();
    expect(table).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(table).toHaveTextContent("\\u202e");
    expect(screen.getByTestId("count")).toHaveTextContent("2 line(s) from the MOCK store");
    await userEvent.click(screen.getByRole("button", { name: "Ping Gateway" }));
    expect(within(table).queryByText(/<img/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All products" }));
    await userEvent.click(screen.getByRole("button", { name: "warn" }));
    expect(table).toHaveTextContent("<img");
    expect(within(table).queryByText("ok")).toBeNull();
    expect(screen.getByTestId("hops")).toHaveTextContent(/traceparent: 00-a{32}-1{16}-01/);
  });
  it("a bad query shows the server's reason, not a crash", async () => {
    await ready();
    await userEvent.clear(screen.getByTestId("query"));
    await userEvent.type(screen.getByTestId("query"), "junk");
    await userEvent.click(screen.getByTestId("run"));
    expect(await screen.findByTestId("query-error")).toHaveTextContent("a query starts with a label selector");
  });
  it("a scenario with an action runs it (mock), loads its query and shows the lesson", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("scenario-login-burst"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/incident" && c.opts.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url === "/api/incident").opts.body)).toEqual({ name: "login-burst" });
    expect(await screen.findByTestId("lesson")).toHaveTextContent("Eight in two minutes.");
    expect(screen.getByTestId("query")).toHaveValue('{service="pingfederate"} |= "FAILURE"');
    await waitFor(() => expect(screen.getByTestId("log-table").querySelectorAll("tbody tr").length).toBe(3));
  });
  it("in Real mode, scenarios that change the mock stream are disabled with a reason", async () => {
    state.mode = "real";
    await ready();
    expect(screen.getByTestId("scenario-login-burst")).toBeDisabled();
    expect(screen.getByTestId("scenario-login-burst")).toHaveAttribute("title", expect.stringContaining("Switch to Mock"));
    expect(screen.getByTestId("scenario-follow-a-signin")).toBeEnabled();
  });
  it("the relabel-off scenario yields an empty table that says nothing reported an error", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("scenario-everything-went-quiet"));
    expect(await screen.findByTestId("empty")).toHaveTextContent("nothing reported an error");
  });
});

describe("label lab and alerts", () => {
  it("turning the relabel rule off flips the counts and the silence rule fires; Reset restores", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Label lab" }));
    await waitFor(() => expect(screen.getByTestId("count-service")).toHaveTextContent("2"));
    await userEvent.click(screen.getByTestId("relabel-toggle"));
    await waitFor(() => expect(screen.getByTestId("relabel-msg")).toHaveTextContent("returns nothing"));
    await waitFor(() => expect(screen.getByTestId("count-service")).toHaveTextContent("0"));
    await userEvent.click(screen.getByRole("tab", { name: "Alerts" }));
    expect(await screen.findByTestId("alert-ProductLogSilence")).toHaveAttribute("data-state", "firing");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("alert-ProductLogSilence")).toHaveAttribute("data-state", "ok"));
  });
  it("Simulate burst makes the rule fire; in Real mode the buttons are disabled", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Alerts" }));
    expect(await screen.findByTestId("alert-FailedLoginBurst")).toHaveAttribute("data-state", "ok");
    await userEvent.click(screen.getByTestId("sim-burst"));
    await waitFor(() => expect(screen.getByTestId("alert-FailedLoginBurst")).toHaveAttribute("data-state", "firing"));
    await userEvent.click(screen.getByTestId("mode-real"));
    await waitFor(() => expect(screen.getByTestId("sim-burst")).toBeDisabled());
  });
  it("the label lab says it is disabled in Real mode", async () => {
    state.mode = "real";
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Label lab" }));
    expect(screen.getByTestId("label-real")).toHaveTextContent("disabled in Real mode");
  });
});

describe("products and pipeline", () => {
  it("every claim carries a status tag", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Products" }));
    expect(screen.getByTestId("product-pingfederate")).toHaveTextContent("UNVERIFIED");
    expect(screen.getByTestId("facts")).toHaveTextContent("measured");
  });
  it("draws the boxes from /api/diagram and Simulate highlights a step; Reset clears it", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Pipeline" }));
    expect(await screen.findByText("Collector: discover + relabel to service")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/diagram?vertical=retail&name=log-pipeline"))).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /simulate/i }));
    expect(await screen.findByTestId("pattern-now")).toHaveTextContent("Step 1: stdout");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
});

describe("talk track, presenter mode, banner", () => {
  it("presenter mode keeps the banner and shows the say-text; Esc leaves", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Talk track" }));
    expect(screen.getByTestId("talk-track")).toHaveTextContent("Everything is simulated.");
    await userEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("Everything is simulated.");
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the banner is visible on every tab", async () => {
    await ready();
    for (const name of ["Products", "Pipeline", "Label lab", "Alerts", "Talk track"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByTestId("banner")).toBeVisible();
    }
  });
  it("when both calls fail, the banner says SIMULATED and stays visible", async () => {
    const dead = async () => ({ ok: false, status: 500, json: async () => ({}) });
    override["/api/info"] = dead; override["/api/scenarios"] = dead;
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN));
    expect(screen.getByTestId("banner")).toBeVisible();
  });
});

describe("UI standard", () => {
  it("imports the vendored standalone-ui.css before app.css", async () => {
    const main = (await import("./main.jsx?raw")).default;
    expect(main.indexOf('import "./standalone-ui.css"')).toBeGreaterThan(-1);
    expect(main.indexOf('import "./standalone-ui.css"')).toBeLessThan(main.indexOf('import "./app.css"'));
  });
});

describe("diagram edge labels", () => {
  it("nudges the two labels of a back-and-forth pair in opposite directions and leaves the rest alone", () => {
    expect(labelOffsets([{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }])).toEqual([-16, 16, 0]);
    expect(labelOffsets([])).toEqual([]);
  });
});
