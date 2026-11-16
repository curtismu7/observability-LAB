import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import App from "./App";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has only { shelfUrl }, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });

function stubFetch(shelfPayload) {
  globalThis.fetch = vi.fn(async (url) => {
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url === "/api/shelf") return json(shelfPayload);
    if (url === "/api/info") return json({ mode: "mock", source: "mock", simulated: true, realAvailable: false, realHint: null });
    return json({}, 404);
  });
}
beforeEach(() => { window.location.hash = ""; });
afterEach(() => { cleanup(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    stubFetch({ shelfUrl: "https://shelf.example", demos: [
      { id: "other-lab", verification: mark("in-progress", "In progress") },
      { id: "observability-lab", verification: mark("verified", "Verified", { note: "Every tab walked on the mock" }) },
    ] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every tab walked on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (only { shelfUrl }), or when the shelf has no mark for it", async () => {
    for (const payload of [
      { shelfUrl: "https://shelf.example" },
      { shelfUrl: "https://shelf.example", demos: [{ id: "observability-lab", verification: null }] },
      { shelfUrl: "https://shelf.example", demos: [{ id: "observability-lab", verification: mark("none", "") }] },
    ]) {
      stubFetch(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
