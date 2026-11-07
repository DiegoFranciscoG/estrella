import { describe, expect, it } from "vitest";
import {
  addBuilding, area, centroid, entry, floorsFor, fromGeoJSON, grid, inside, newSite, parseSite, planSun, ratios, rectangle, shaded, shadowPieces,
  sunHours, daySamples, toLocal, type Building, type Site,
} from "../../apps/sitio/site";
import { clock, compass, instant, sunDay, sunPosition } from "../../apps/sitio/sun";

const near = (minutes: number | null, hhmm: string, tolerance = 1) => {
  const [h, m] = hhmm.split(":").map(Number);
  expect(Math.abs((minutes ?? NaN) - (h * 60 + m))).toBeLessThanOrEqual(tolerance);
};

describe("Sun (NOAA equations)", () => {
  it("gives Quito's sunrise, noon and sunset through the year", () => {
    const june = sunDay({ year: 2026, month: 6, day: 21 }, -0.22, -78.51, -5);
    near(june.sunrise, "06:13");
    near(june.sunset, "18:19");
    const november = sunDay({ year: 2026, month: 11, day: 3 }, -0.22, -78.51, -5);
    near(november.sunrise, "05:54");
    near(november.noon, "11:58");
    expect(june.polar).toBeNull();
  });

  it("places the sun north at the June solstice and south in December, seen from Quito", () => {
    const at = (month: number, day: number) => {
      const d = sunDay({ year: 2026, month, day }, -0.22, -78.51, -5);
      return sunPosition(instant({ year: 2026, month, day }, d.noon, -5), -0.22, -78.51);
    };
    const june = at(6, 21);
    expect(june.declination).toBeCloseTo(23.44, 1);
    expect(june.altitude).toBeCloseTo(66.35, 1);
    expect(compass(june.azimuth)).toBe("Norte");
    const december = at(12, 21);
    expect(december.declination).toBeCloseTo(-23.44, 1);
    expect(compass(december.azimuth)).toBe("Sur");
    expect(at(11, 3).equationOfTime).toBeCloseTo(16.4, 0);
    expect(at(2, 11).equationOfTime).toBeCloseTo(-14.2, 0);
  });

  it("works far from the equator, including polar day and night", () => {
    const ny = sunDay({ year: 2026, month: 6, day: 21 }, 40.7128, -74.006, -4);
    near(ny.sunrise, "05:25");
    near(ny.sunset, "20:31");
    expect(sunDay({ year: 2026, month: 6, day: 21 }, 69.65, 18.96, 2)).toMatchObject({ polar: "day", sunrise: null, dayLength: 1440 });
    expect(sunDay({ year: 2026, month: 12, day: 21 }, 69.65, 18.96, 1)).toMatchObject({ polar: "night", dayLength: 0 });
    expect(clock(375.4)).toBe("06:15");
    expect(clock(1439.8)).toBe("00:00");
    expect(compass(93)).toBe("Este");
  });
});

describe("Plan geometry", () => {
  const square = rectangle(10, 10, 5, 5);

  it("measures polygons and finds where a ray enters them", () => {
    expect(area(square)).toBe(100);
    expect(inside([5, 5], square)).toBe(true);
    expect(inside([15, 5], square)).toBe(false);
    expect(entry([5, 15], [0, -1], square)).toBeCloseTo(5, 9);
    expect(entry([5, 5], [0, -1], square)).toBe(0);
    expect(entry([5, 15], [0, 1], square)).toBeNull();
  });

  it("turns the sun with the plan's north arrow", () => {
    // True north drawn towards the plan's right: the eastern sun then shines from the bottom.
    const sun = planSun(30, 90, 90);
    expect(sun.azimuth).toBe(180);
    expect(sun.toward[0]).toBeCloseTo(0, 9);
    expect(sun.toward[1]).toBeCloseTo(-1, 9);
    expect(planSun(30, 90, 0).toward[0]).toBeCloseTo(1, 9);
  });
});

describe("Shadows and hours of sun", () => {
  const tower: Building = { id: "b1", name: "Torre", points: rectangle(10, 10, 5, 5), height: 10, floors: 3 };

  it("casts a shadow as long as the building is tall when the sun is at 45°", () => {
    const sun = planSun(45, 180, 0); // Sun to the south: the shadow falls north.
    const pieces = shadowPieces(tower, sun);
    expect(pieces).toHaveLength(2 + 4);
    const moved = pieces[1];
    expect(Math.max(...moved.map((p) => p[1]))).toBeCloseTo(20, 9);
    expect(shadowPieces(tower, planSun(-2, 180, 0))).toEqual([]);
  });

  it("knows which points the building shades", () => {
    const sun = planSun(45, 180, 0);
    expect(shaded([5, 15], sun, [tower])).toBe(true);
    expect(shaded([5, 25], sun, [tower])).toBe(false);
    expect(shaded([25, 15], sun, [tower])).toBe(false);
  });

  it("counts fewer hours of sun beside a tower than in the open, about 12 h at the equator", () => {
    const site: Site = { ...newSite("2026-03-20"), lat: 0, lon: -78.5, buildings: [{ ...tower, height: 30 }] };
    const samples = daySamples(site, 10);
    const [open, beside, under] = sunHours([[60, 60], [12, 5], [5, 5]], samples, site, 10);
    expect(open).toBeGreaterThan(11.5);
    expect(open).toBeLessThan(12.5);
    expect(beside!).toBeLessThan(open!);
    expect(under).toBeNull();
  });

  it("builds an analysis grid inside the lot and widens it for huge lots", () => {
    const lot = rectangle(4, 3, 2, 1.5);
    expect(grid(lot, 1).points).toHaveLength(12);
    const huge = grid(rectangle(2000, 2000), 1);
    expect(huge.spacing).toBeGreaterThan(1);
    expect(huge.points.length).toBeLessThanOrEqual(12_000);
  });
});

describe("Land use ratios", () => {
  it("computes COS PB and COS total from the lot and the buildings", () => {
    let site: Site = { ...newSite("2026-06-21"), lot: rectangle(20, 30) };
    site = addBuilding(site, rectangle(10, 12), 9)!.site;
    expect(site.buildings[0]).toMatchObject({ id: "b1", name: "Edificio 1", floors: 3 });
    expect(ratios(site)).toEqual({ lot: 600, footprint: 120, built: 360, cosPB: 0.2, cosTotal: 0.6 });
    // A neighbour drawn outside the lot casts shadows but does not count in the ratios.
    const withNeighbour = addBuilding(site, rectangle(10, 10, 0, 40), 30)!.site;
    expect(ratios(withNeighbour).footprint).toBe(120);
    const [cx, cy] = centroid([[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]]);
    expect(cx).toBeCloseTo(42 / 18, 9);
    expect(cy).toBeCloseTo(33 / 18, 9);
    expect(ratios(newSite("2026-06-21")).cosPB).toBeNull();
    expect(floorsFor(1)).toBe(1);
    expect(addBuilding(site, [[0, 0], [1, 1]])).toBeNull();
  });
});

describe("GeoJSON import", () => {
  it("projects WGS84 coordinates to local metres", () => {
    const [x, y] = toLocal(-78.5, -0.199, { lon: -78.5, lat: -0.2 });
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(111.19, 1);
  });

  it("reads buildings with their heights and the lot", () => {
    const square = (lon: number, lat: number, size = 0.0001) => [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]];
    const data = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { lote: true }, geometry: { type: "Polygon", coordinates: square(-78.5, -0.2, 0.0003) } },
        { type: "Feature", properties: { name: "Torre", height: "12,5 m" }, geometry: { type: "Polygon", coordinates: square(-78.4999, -0.1999) } },
        { type: "Feature", properties: { "building:levels": 4 }, geometry: { type: "MultiPolygon", coordinates: [square(-78.4998, -0.1998)] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-78.5, -0.2] } },
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] } },
      ],
    };
    const result = fromGeoJSON(data);
    expect(result.skipped).toBe(2);
    expect(result.lot).not.toBeNull();
    expect(area(result.lot!)).toBeCloseTo(33.4 * 33.4, -1);
    expect(result.buildings.map((b) => [b.name, b.height])).toEqual([["Torre", 12.5], ["", 12]]);
    expect(area(result.buildings[0].points)).toBeCloseTo(11.13 * 11.13, 0);
    expect(fromGeoJSON({ type: "Nope" }).buildings).toEqual([]);
  });
});

describe("Saved site", () => {
  it("restores a valid site and drops broken parts", () => {
    let site: Site = { ...newSite("2026-06-21"), lot: rectangle(20, 30), north: 15, minutes: 600 };
    site = addBuilding(site, rectangle(10, 12), 9, "Bloque A")!.site;
    const saved = JSON.parse(JSON.stringify(site));
    expect(parseSite(saved, "2026-01-01")).toEqual(site);
    const broken = parseSite({
      ...saved, lat: 200, date: "2026-13-45", minutes: 5000, lot: [[0, 0], [1, 1]],
      buildings: [...saved.buildings, { ...saved.buildings[0] }, { ...saved.buildings[0], id: "b2", height: -1 }, { id: "x", points: [], height: 3 }],
    }, "2026-01-01");
    expect(broken.lat).toBe(-0.22);
    expect(broken.date).toBe("2026-01-01");
    expect(broken.minutes).toBe(720);
    expect(broken.lot).toBeNull();
    expect(broken.buildings.map((b) => b.id)).toEqual(["b1"]);
    expect(parseSite(null, "2026-01-01")).toEqual(newSite("2026-01-01"));
  });
});
