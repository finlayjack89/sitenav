export default async (req, context) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    return new Response(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Login</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #0f172a; color: white; }
          .form-container { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; border: 1px solid rgba(255,255,255,0.1); width: 100%; max-width: 320px; }
          input[type="password"] { padding: 12px; margin: 15px 0; width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(0,0,0,0.2); color: white; font-size: 1rem; }
          input[type="password"]:focus { outline: none; border-color: #3b82f6; }
          button { padding: 12px 20px; background-color: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; width: 100%; font-size: 1rem; font-weight: bold; transition: background-color 0.2s; }
          button:hover { background-color: #2563eb; }
          .error { color: #ef4444; font-size: 0.9em; margin-top: 10px; }
          h2 { margin-top: 0; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="form-container">
          <h2>Admin Access Required</h2>
          <form method="POST" action="">
            <input type="password" name="password" placeholder="Enter Admin Password" required autofocus>
            <button type="submit">Unlock Admin</button>
            ${url.searchParams.has('error') ? '<div class="error">Incorrect password. Please try again.</div>' : ''}
          </form>
        </div>
      </body>
      </html>
    `, {
      headers: { "content-type": "text/html" }
    });
  }

  if (req.method === 'POST') {
    try {
      const clone = req.clone();
      const formData = await clone.formData();
      const password = formData.get('password');
      // If we're testing without env configured, use fallback or just block
      const adminPassword = Netlify.env.get('ADMIN_PASSWORD');

      if (adminPassword && password === adminPassword) {
        // Correct password, fetch actual page
        return context.next();
      } else {
        url.searchParams.set('error', '1');
        return Response.redirect(url.toString(), 303);
      }
    } catch (e) {
      // In case of error (e.g., not form-encoded), proceed to next if it was actually a valid admin API request etc.
      // But since this protects the HTML page, we might just fail.
      return context.next();
    }
  }

  return context.next();
};

export const config = {
  path: "/admin.html"
};
