import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createParksRouter, type ParksFetch } from "./parks";

const createTestApp = (fetchParks: ParksFetch) => {
  const app = express();
  app.use("/api/permits", createParksRouter(fetchParks));
  return app;
};

describe("NYC Parks discovery", () => {
  it("validates borough codes strictly before calling NYC Open Data", async () => {
    const fetchParks = vi.fn<ParksFetch>();
    const app = createTestApp(fetchParks);

    for (const query of ["", "?borough=manhattan", "?borough=m", "?borough=%20M"]) {
      const response = await request(app).get(`/api/permits/nyc/discover${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "borough must be one of M, B, Q, X, R" });
    }
    expect(fetchParks).not.toHaveBeenCalled();
  });

  it("accepts every borough code and defaults limit to 10", async () => {
    const fetchParks = vi.fn<ParksFetch>(async () => Response.json([]));
    const app = createTestApp(fetchParks);

    for (const borough of ["M", "B", "Q", "X", "R"]) {
      const response = await request(app).get(`/api/permits/nyc/discover?borough=${borough}`);
      expect(response.status).toBe(200);
    }

    for (const [index, borough] of ["M", "B", "Q", "X", "R"].entries()) {
      const url = new URL(fetchParks.mock.calls[index]?.[0] as string);
      expect(url.searchParams.get("$where")).toBe(`borough='${borough}'`);
      expect(url.searchParams.get("$limit")).toBe("10");
    }
  });

  it("uses a bounded integer limit", async () => {
    const fetchParks = vi.fn<ParksFetch>(async () => Response.json([]));
    const app = createTestApp(fetchParks);

    for (const limit of ["0", "51", "1.5", "ten"]) {
      const response = await request(app).get(`/api/permits/nyc/discover?borough=M&limit=${limit}`);
      expect(response.status).toBe(400);
    }

    for (const limit of ["1", "50"]) {
      const response = await request(app).get(`/api/permits/nyc/discover?borough=M&limit=${limit}`);
      expect(response.status).toBe(200);
    }

    expect(fetchParks).toHaveBeenCalledTimes(2);
    expect(
      fetchParks.mock.calls.map(([input]) => new URL(input).searchParams.get("$limit")),
    ).toEqual(["1", "50"]);
  });

  it("queries only required fields in a deterministic order and maps the response", async () => {
    const fetchParks = vi.fn<ParksFetch>(async () =>
      Response.json([
        {
          system: "M010-EVENTAREA-2728",
          gispropnum: "M010",
          name: "102nd Street Cross Drive",
          borough: "M",
          areatype: "Road",
          acres: "1.00380087",
          multipolygon: { ignored: true },
        },
        { gispropnum: "M999" },
      ]),
    );

    const response = await request(createTestApp(fetchParks)).get(
      "/api/permits/nyc/discover?borough=M&limit=2",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "SUCCESS",
      spaces: [
        {
          locationId: "M010-EVENTAREA-2728",
          parkName: "102nd Street Cross Drive",
          borough: "M",
          type: "Road",
          acres: "1.00380087",
        },
        {
          locationId: "M999",
          parkName: "NYC Park Zone",
          borough: "M",
          type: "Special Event Area",
          acres: "N/A",
        },
      ],
    });

    const url = new URL(fetchParks.mock.calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe("https://data.cityofnewyork.us/resource/c5vm-g2dk.json");
    expect(url.searchParams.get("$select")).toBe("system,gispropnum,name,borough,areatype,acres");
    expect(url.searchParams.get("$order")).toBe("name ASC,system ASC");
  });

  it("returns a generic 502 for upstream HTTP, network, and payload failures", async () => {
    const failures = [
      async () => new Response("unavailable", { status: 503 }),
      async () => {
        throw new Error("socket details");
      },
      async () => Response.json({ error: "unexpected shape" }),
    ];

    for (const fetchParks of failures) {
      const response = await request(createTestApp(fetchParks)).get(
        "/api/permits/nyc/discover?borough=Q",
      );
      expect(response.status).toBe(502);
      expect(response.body).toEqual({
        error: "NYC Parks discovery is temporarily unavailable",
      });
    }
  });
});
