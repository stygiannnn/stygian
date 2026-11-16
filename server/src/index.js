// stygian API worker — serves the Svelte client and handles /api/* routes.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(url, request, env);
    }

    // Everything else is served by the static client (SPA).
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(url, request, env) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    return Response.json({
      ok: true,
      service: "stygian",
      time: new Date().toISOString(),
    });
  }

  return Response.json({ ok: false, error: "not_found" }, { status: 404 });
}
