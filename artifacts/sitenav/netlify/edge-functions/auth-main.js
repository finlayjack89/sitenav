export default async (req, context) => {
  const url = new URL(req.url);

  const sitePassword = Netlify.env.get('SITE_PASSWORD');

  if (!sitePassword) {
    return context.next();
  }

  // Check for session cookie
  const cookieHeader = req.headers.get("cookie");
  const isAuthenticated = cookieHeader && cookieHeader.includes("sitenav_session=authenticated");

  if (req.method === 'POST') {
    try {
      const clone = req.clone();
      const formData = await clone.formData();
      if (formData.has('site_login_attempt')) {
        const password = formData.get('password');
        if (password === sitePassword) {
          // Success! Clear URL params if it had error
          url.searchParams.delete('auth_error');
          const res = new Response(null, {
            status: 303,
            headers: { "Location": url.pathname + url.search }
          });
          // 3600 seconds = 1 hour session
          res.headers.append("Set-Cookie", "sitenav_session=authenticated; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict");
          return res;
        } else {
          url.searchParams.set('auth_error', '1');
          return Response.redirect(url.toString(), 303);
        }
      }
    } catch (e) {
      // Ignored non-form-data POST
    }
  }

  if (isAuthenticated) {
    return context.next();
  }

  // Only prompt for HTML requests
  const acceptHeader = req.headers.get("accept") || "";
  if (!acceptHeader.includes("text/html")) {
    return context.next();
  }

  return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SiteNav Access</title>
      <style>
        body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #0f172a; color: white; }
        .form-container { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; border: 1px solid rgba(255,255,255,0.1); width: 100%; max-width: 320px; }
        input[type="password"] { padding: 12px; margin: 15px 0; width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(0,0,0,0.2); color: white; font-size: 1rem; }
        input[type="password"]:focus { outline: none; border-color: #3b82f6; }
        button { padding: 12px 20px; background-color: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; width: 100%; font-size: 1rem; font-weight: bold; transition: background-color 0.2s; }
        button:hover { background-color: #2563eb; }
        .error { color: #ef4444; font-size: 0.9em; margin-top: 10px; }
        h2 { margin-top: 0; font-weight: 600; }
        p { color: #94a3b8; font-size: 0.9em; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="form-container">
        <h2>SiteNav Access</h2>
        <p>Please enter the shared password to continue.</p>
        <form method="POST" action="">
          <input type="hidden" name="site_login_attempt" value="1">
          <input type="password" name="password" placeholder="Enter Site Password" required autofocus>
          <button type="submit">Enter Site</button>
          ${url.searchParams.has('auth_error') ? '<div class="error">Incorrect password. Please try again.</div>' : ''}
        </form>
      </div>
    </body>
    </html>
  `, {
    headers: { "content-type": "text/html" }
  });
};

export const config = {
  path: "/*",
  excludedPath: ["/admin.html", "/*.js", "/*.css", "/*.json", "/*.svg", "/*.png", "/*.jpg", "/*.ico"]
};
