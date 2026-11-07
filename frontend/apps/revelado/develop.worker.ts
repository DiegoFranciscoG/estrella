/// <reference lib="webworker" />
/** Develops the full-size photo off the page's thread, so the program stays responsive. */
import { develop, parseSettings } from "./develop";

self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray<ArrayBuffer>; settings: unknown }>) => {
  const { data, settings } = event.data;
  const out = develop(data, parseSettings(settings), data);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ data: out }, [out.buffer]);
};
