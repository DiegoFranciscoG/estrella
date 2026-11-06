import { afterEach, describe, expect, it } from "vitest";
import { databaseName, ProjectStore } from "../../src/core/store";

const ANA = "11111111-1111-4111-8111-111111111111";
const EVA = "22222222-2222-4222-8222-222222222222";
const opened: ProjectStore[] = [];

async function storeFor(user: string): Promise<ProjectStore> {
  const s = await ProjectStore.open(user);
  opened.push(s);
  return s;
}

afterEach(async () => {
  opened.splice(0).forEach((s) => s.close());
  await ProjectStore.deleteAll(ANA);
  await ProjectStore.deleteAll(EVA);
});

describe("ProjectStore", () => {
  it("rejects anything that is not a user id as database name", () => {
    expect(() => databaseName("../otra")).toThrow();
    expect(databaseName(ANA.toUpperCase())).toBe(`estrella-${ANA}`);
  });

  it("creates, lists newest first and renames projects", async () => {
    const s = await storeFor(ANA);
    const a = await s.create("apuntes", "Primero", 1000);
    const b = await s.create("apuntes", "Segundo", 2000);
    await s.rename(a.id, "  Renombrado  ");
    await s.rename(b.id, "   ");
    const list = await s.list();
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(list.find((p) => p.id === a.id)?.title).toBe("Renombrado");
    expect(list.find((p) => p.id === b.id)?.title).toBe("Segundo");
  });

  /** T-08: two accounts on the same browser never see each other's projects. */
  it("keeps each account's projects apart", async () => {
    const ana = await storeFor(ANA);
    const eva = await storeFor(EVA);
    const p = await ana.create("apuntes", "De Ana");
    expect(await eva.list()).toEqual([]);
    expect(await eva.get(p.id)).toBeUndefined();
  });

  /** T-03: an abrupt end is detected on the next open and the last snapshot is offered. */
  it("reports recovery after an abrupt close and not after a clean one", async () => {
    const s = await storeFor(ANA);
    const p = await s.create("apuntes", "Nota", 1000);

    const first = await s.open(p.id, 2000);
    expect(first.recoveredFrom).toBeNull();
    await s.saveSnapshot(p.id, '{"v":1,"body":"hola"}', "Nota", 5000);
    // Tab killed here: markClosed is never called.

    const second = await s.open(p.id, 9000);
    expect(second.recoveredFrom).toBe(5000);
    expect(second.project.data).toContain("hola");

    await s.markClosed(p.id);
    const third = await s.open(p.id, 12000);
    expect(third.recoveredFrom).toBeNull();
  });

  it("does not claim a recovery when nothing had been written", async () => {
    const s = await storeFor(ANA);
    const p = await s.create("apuntes", "Vacía");
    await s.open(p.id);
    expect((await s.open(p.id)).recoveredFrom).toBeNull();
  });

  /** T-03 repeated: twenty abrupt ends at different moments, every one recovers the last snapshot. */
  it("recovers the latest snapshot after twenty abrupt ends", async () => {
    const s = await storeFor(ANA);
    const p = await s.create("apuntes", "Larga");
    let t = 1000;
    await s.open(p.id, t);
    for (let i = 1; i <= 20; i++) {
      t += 500 + i * 37;
      await s.saveSnapshot(p.id, `{"v":1,"body":"versión ${i}"}`, undefined, t);
      const reopened = await s.open(p.id, t + 1000);
      expect(reopened.recoveredFrom).toBe(t);
      expect(reopened.project.data).toContain(`versión ${i}`);
    }
  });

  it("ignores snapshots for deleted projects and measures usage", async () => {
    const s = await storeFor(ANA);
    const p = await s.create("apuntes", "Borrar");
    await s.saveSnapshot(p.id, "x".repeat(100), undefined);
    expect(await s.usedBytes()).toBe((100 + "Borrar".length) * 2);
    await s.remove(p.id);
    await s.saveSnapshot(p.id, "y", undefined);
    expect(await s.get(p.id)).toBeUndefined();
    await expect(s.open(p.id)).rejects.toThrow(/no existe/);
  });

  it("deletes every project of an account", async () => {
    const s = await storeFor(ANA);
    await s.create("apuntes", "Uno");
    s.close();
    opened.pop();
    await ProjectStore.deleteAll(ANA);
    expect(await (await storeFor(ANA)).list()).toEqual([]);
  });
});
