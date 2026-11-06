import { afterEach, describe, expect, it, vi } from "vitest";
import { findProgram, programs, validateCatalog } from "../../src/core/catalog";
import { passwordProblems } from "../../src/core/password";
import { advice, DeviceInfo, formatMb, isLite, liteReasons, readDevice } from "../../src/core/resources";
import { api, ApiError, refresh, setAccessToken, userIdFromToken } from "../../src/core/api";
import { safeStorage } from "../../src/core/storage";

const modest: DeviceInfo = { memoryGb: 4, cores: 2, saveData: false, reducedMotion: false };
const strong: DeviceInfo = { memoryGb: 16, cores: 8, saveData: false, reducedMotion: false };

describe("password rules", () => {
  it("accepts a long passphrase", () => {
    expect(passwordProblems("mi gato duerme en la azotea", "ana@example.com")).toEqual([]);
  });
  it("explains each problem", () => {
    expect(passwordProblems("corta", "ana@example.com")).toContain("Usa al menos 10 caracteres");
    expect(passwordProblems("1234567890", "x@example.com")).toContain("Es una contraseña muy común");
    expect(passwordProblems("anabelita2026!", "anabelita@example.com")).toContain("No incluyas tu correo en la contraseña");
    expect(passwordProblems("abababababab", "x@example.com")).toContain("Repite demasiado los mismos caracteres");
    expect(passwordProblems("a".repeat(129), "x@example.com")).toContain("Usa como máximo 128 caracteres");
  });
});

describe("resources", () => {
  it("turns lite mode on automatically only for modest devices", () => {
    expect(isLite(modest, "auto")).toBe(true);
    expect(isLite(strong, "auto")).toBe(false);
    expect(isLite({ ...strong, saveData: true }, "auto")).toBe(true);
    expect(isLite({ memoryGb: null, cores: null, saveData: false, reducedMotion: false }, "auto")).toBe(false);
  });
  it("lets the student override it", () => {
    expect(isLite(modest, "off")).toBe(false);
    expect(isLite(strong, "on")).toBe(true);
  });
  it("explains why lite mode is on", () => {
    expect(liteReasons(modest)).toEqual(["tu equipo informa 4 GB de memoria", "tu procesador tiene 2 núcleos"]);
  });
  it("gives concrete advice and none when everything is fine", () => {
    expect(advice(strong, { heapMb: 50, storageUsedMb: 10, storageQuotaMb: 1000, projectsMb: 10 })).toEqual([]);
    const tips = advice(modest, { heapMb: 2000, storageUsedMb: 900, storageQuotaMb: 1000, projectsMb: 300 });
    expect(tips).toHaveLength(4);
  });
  it("formats sizes for people", () => {
    expect(formatMb(null)).toBe("no disponible");
    expect(formatMb(0.5)).toBe("512 KB");
    expect(formatMb(300)).toBe("300 MB");
    expect(formatMb(2048)).toBe("2.0 GB");
  });
  it("reads only what the browser exposes", () => {
    const device = readDevice({ hardwareConcurrency: 4 } as Navigator, { matchMedia: () => ({ matches: true }) } as unknown as Window);
    expect(device).toEqual({ memoryGb: null, cores: 4, saveData: false, reducedMotion: true });
  });
});

describe("catalog", () => {
  it("is valid and has the first available program", () => {
    expect(findProgram("apuntes")?.status).toBe("disponible");
    expect(programs.length).toBeGreaterThanOrEqual(15);
  });
  it("rejects inconsistent data", () => {
    const ok = { ...programs[0] };
    expect(() => validateCatalog({})).toThrow();
    expect(() => validateCatalog([ok, ok])).toThrow(/repeated/);
    expect(() => validateCatalog([{ ...ok, id: "Mal Id" }])).toThrow(/invalid/);
    expect(() => validateCatalog([{ ...ok, appPath: null }])).toThrow(/appPath/);
    expect(() => validateCatalog([{ ...ok, appPath: "https://otro.sitio/x.html" }])).toThrow(/appPath/);
    expect(() => validateCatalog([{ ...ok, availability: "luna" }])).toThrow(/availability/);
    expect(() => validateCatalog([{ ...ok, honestNote: "" }])).toThrow(/text/);
  });
});

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it("sends the client header, cookies and bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("abc");
    await api("/me", { auth: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect(init.headers["X-Estrella-Client"]).toBe("web");
    expect(init.headers.Authorization).toBe("Bearer abc");
  });

  it("refreshes once on 401 and retries", async () => {
    const token = `x.${btoa(JSON.stringify({ sub: "11111111-1111-4111-8111-111111111111" }))}.y`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: token, expiresIn: 900, email: "a@b.c", keys: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: "a@b.c" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("old");
    expect(await api<{ email: string }>("/me", { auth: true })).toEqual({ email: "a@b.c" });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${token}`);
  });

  it("turns problem details and network failures into readable errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "VALIDATION", detail: "Hay datos inválidos", fields: ["email"] }), { status: 400 })));
    await expect(api("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({ code: "VALIDATION", fields: ["email"] });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/me")).rejects.toBeInstanceOf(ApiError);
    await expect(refresh()).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("reads the user id from the token", () => {
    const token = `x.${btoa(JSON.stringify({ sub: "abc" })).replace(/=+$/, "")}.y`;
    expect(userIdFromToken(token)).toBe("abc");
    expect(() => userIdFromToken("nope")).toThrow();
  });
});

describe("safe storage", () => {
  it("survives a browser that blocks storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const spySet = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(safeStorage.get("x")).toBeNull();
    expect(() => safeStorage.set("x", "y")).not.toThrow();
    spy.mockRestore();
    spySet.mockRestore();
  });
});
