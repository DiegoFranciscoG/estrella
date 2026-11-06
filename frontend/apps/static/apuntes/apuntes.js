// Apuntes: the first ESTRELLA program. It runs in a sandboxed frame and only talks to the panel
// through postMessage; the panel decides where its work is stored.
(function () {
  "use strict";

  var SNAPSHOT_DELAY_MS = 800;
  var PERIODIC_MS = 20000;

  var title = document.getElementById("title");
  var body = document.getElementById("body");
  var count = document.getElementById("count");
  var timer = null;
  var dirty = false;
  var ready = false;

  // Only the ESTRELLA panel may embed this page (frame-ancestors), so the parent is the panel.
  // Where the browser exposes it, the message is still addressed to the panel's exact origin.
  var PANEL = (location.ancestorOrigins && location.ancestorOrigins[0]) || "*";

  function send(message) {
    window.parent.postMessage(message, PANEL === "null" ? "*" : PANEL);
  }

  function serialize() {
    return JSON.stringify({ v: 1, body: body.value });
  }

  function parse(data) {
    if (!data) return "";
    try {
      var parsed = JSON.parse(data);
      return parsed && typeof parsed.body === "string" ? parsed.body : "";
    } catch (e) {
      return "";
    }
  }

  function snapshot() {
    if (!ready) return;
    clearTimeout(timer);
    timer = null;
    dirty = false;
    send({ type: "estrella:snapshot", data: serialize(), title: title.value.slice(0, 120) });
  }

  function changed() {
    dirty = true;
    updateCount();
    clearTimeout(timer);
    timer = setTimeout(snapshot, SNAPSHOT_DELAY_MS);
  }

  function updateCount() {
    var words = body.value.trim() ? body.value.trim().split(/\s+/).length : 0;
    count.textContent = words === 1 ? "1 palabra" : words + " palabras";
  }

  function insertLine(prefix) {
    var start = body.selectionStart;
    var before = body.value.slice(0, start);
    var needsBreak = before.length > 0 && !before.endsWith("\n");
    var text = (needsBreak ? "\n" : "") + prefix;
    body.setRangeText(text, start, body.selectionEnd, "end");
    body.focus();
    changed();
  }

  function download(extension, type) {
    var name = (title.value.trim() || "apuntes").replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 80) || "apuntes";
    var content = extension === "md" && title.value.trim() ? "# " + title.value.trim() + "\n\n" + body.value : body.value;
    var url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name + "." + extension;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var m = event.data;
    if (!m || typeof m.type !== "string") return;
    if (m.type === "estrella:init") {
      document.documentElement.dataset.theme = m.theme === "dark" ? "dark" : "light";
      title.value = typeof m.title === "string" ? m.title : "";
      body.value = parse(m.data);
      updateCount();
      ready = true;
      body.focus();
    } else if (m.type === "estrella:ping") {
      send({ type: "estrella:pong", n: m.n });
    } else if (m.type === "estrella:theme") {
      document.documentElement.dataset.theme = m.theme === "dark" ? "dark" : "light";
    } else if (m.type === "estrella:flush") {
      if (dirty) snapshot();
    }
  });

  body.addEventListener("input", changed);
  title.addEventListener("input", changed);
  document.getElementById("heading").addEventListener("click", function () { insertLine("## "); });
  document.getElementById("list").addEventListener("click", function () { insertLine("- "); });
  document.getElementById("check").addEventListener("click", function () { insertLine("- [ ] "); });
  document.getElementById("date").addEventListener("click", function () {
    insertLine(new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  });
  document.getElementById("export-md").addEventListener("click", function () { download("md", "text/markdown"); });
  document.getElementById("export-txt").addEventListener("click", function () { download("txt", "text/plain"); });
  setInterval(function () { if (dirty) snapshot(); }, PERIODIC_MS);
  window.addEventListener("pagehide", function () { if (dirty) snapshot(); });

  send({ type: "estrella:ready" });
})();
