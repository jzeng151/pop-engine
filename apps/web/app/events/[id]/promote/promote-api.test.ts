import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPromoteState, savePromoteState } from "./promote-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sample = {
  event_id: "11111111-1111-4111-8111-111111111111",
  title: "Demo Night",
  event_date: "2026-08-26",
  venue: "Lot",
  borough: "brooklyn",
  description: "Hello",
  public_page_published: false,
  public_path: "/e/11111111-1111-4111-8111-111111111111",
  map_url: "https://maps.google.com/?q=Lot",
  infeasible_warning: false,
  plan_available: true,
};

describe("promote-api", () => {
  it("loads and patches promote state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sample)),
    );
    await expect(loadPromoteState("https://api.example.com", sample.event_id)).resolves.toEqual({
      ok: true,
      state: sample,
    });

    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { ...sample, public_page_published: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const saved = await savePromoteState("https://api.example.com", sample.event_id, {
      public_page_published: true,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.state.public_page_published).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/events/${sample.event_id}/public-page`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
