// Lienzo opens in Spanish. miniPaint picks its language from ?lang= when it starts; this runs
// before it and adds the parameter without reloading. A student can still change the language
// from its Tools menu.
if (!new URLSearchParams(location.search).has("lang")) {
  history.replaceState(null, "", location.pathname + "?lang=es" + location.hash);
}
