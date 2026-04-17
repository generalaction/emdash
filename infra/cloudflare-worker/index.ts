export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);

    if (pathParts.length >= 2) {
      const owner = pathParts[0];
      const repo = pathParts[1];
      return Response.redirect(`emdash-github://${owner}/${repo}`, 302);
    }

    const html = `<!DOCTYPE html>
<html>
<head><title>Emdash GitHub Quick Link</title></head>
<body>
<h1>Emdash GitHub</h1>
<p>Use: <code>/owner/repo</code></p>
<p>Example: <code>/facebook/react</code></p>
</body>
</html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  },
};
