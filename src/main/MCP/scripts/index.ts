// Scripts run inside a Figma tab via webContents.executeJavaScript. They return
// JSON strings rather than objects: Figma's Plugin API values don't survive
// V8 structured clone across the executeJavaScript boundary.

// responseStatus is the HTTP status of the document itself: Figma answers
// 403 for a file the account can't see and 404 for one that doesn't exist,
// and neither page ever brings up the Plugin API.
export const FILE_STATE_SCRIPT = `(() => {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    const status = nav && typeof nav.responseStatus === "number" ? nav.responseStatus : 0;
    return JSON.stringify({
      ready: !!(window.figma && window.figma.root),
      httpStatus: status > 0 ? status : null,
    });
  } catch {
    return JSON.stringify({ ready: false, httpStatus: null });
  }
})()`;

export const TAB_STATE_SCRIPT = `(() => {
  try {
    return JSON.stringify({
      figma: typeof window.figma,
      hasRoot: !!(window.figma && window.figma.root),
      visibility: document.visibilityState,
      readyState: document.readyState,
      size: [window.innerWidth, window.innerHeight],
      title: document.title,
      text: (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    });
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) });
  }
})()`;
