import { connect } from "../shared/bridge";

/**
 * Glue between miniPaint (vendor/SOURCE.txt lists its single change) and the panel. miniPaint exposes its modules on window once
 * it has loaded; every edit goes through State.do_action, and undo/redo through their own methods,
 * so wrapping those three is enough to know when the image changed.
 */

interface MiniPaint {
  FileOpen: { load_json(data: unknown, ignoreErrors?: boolean): Promise<void> | void };
  FileSave: { export_as_json(): string };
  State: Record<"do_action" | "undo_action" | "redo_action", (...args: unknown[]) => Promise<unknown>>;
}

function whenLoaded(): Promise<MiniPaint> {
  return new Promise((resolve) => {
    const check = () => {
      const w = window as unknown as Partial<MiniPaint>;
      if (w.FileOpen && w.FileSave && w.State) resolve(w as MiniPaint);
      else setTimeout(check, 50);
    };
    if (document.readyState === "complete") check();
    else window.addEventListener("load", check);
  });
}

const app = await whenLoaded();

const bridge = connect({
  async load(data) {
    if (!data) return;
    try {
      await bridge.busy(async () => { await app.FileOpen.load_json(JSON.parse(data), false); });
    } catch {
      // A damaged project opens as a blank canvas; the stored copy is not overwritten until an edit.
    }
  },
  serialize: () => app.FileSave.export_as_json(),
});

for (const method of ["do_action", "undo_action", "redo_action"] as const) {
  const original = app.State[method].bind(app.State);
  app.State[method] = async (...args: unknown[]) => {
    const result = await original(...args);
    bridge.changed();
    return result;
  };
}
