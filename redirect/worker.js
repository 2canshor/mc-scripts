// The old address, mc-scripts.tmcssca.workers.dev, after the tool was renamed Event Centre.
// Pages move to the new address (the #k= part of a join link is kept by the browser).
// API calls from a page still open at the old address are passed to Event Centre, so its unsent scripts still upload.
const NEW = "https://event-centre.tmcssca.workers.dev";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/fonts/")) return env.APP.fetch(request);
    return Response.redirect(NEW + url.pathname + url.search, 301);
  }
};
