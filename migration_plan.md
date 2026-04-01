# End-to-End Cloud Migration Plan

## 1. MCP Servers to Use
To operate with maximum autonomy, we will connect to the following MCP servers (via generic open-source MCPs or a universal router like Composio):
* **Supabase MCP:** To autonomously execute DDL commands, create the SQL tables, and manage security policies.
* **Netlify MCP:** To automatically configure environment variables, setup build settings, and orchestrate serverless API deployments.
* **AWS S3 / Cloudflare MCP:** To interact with your Cloudflare R2 object storage bucket (using the S3 compatibility API) for creating and managing storage configurations.

## 2. Required API Keys and Credentials
The user must provide the following keys in their MCP configuration panel or local `.env` file so the agents can assume control:
* **Supabase:**
  * `SUPABASE_URL`
  * `SUPABASE_KEY` (Service role key preferred for DDL table creation and row-level security overrides).
* **Netlify:**
  * Netlify Access Token (or OAuth setup in the MCP provider) to create projects and manage environment variables.
* **Cloudflare R2:**
  * `R2_ENDPOINT` (Format: `https://<account-id>.r2.cloudflarestorage.com`)
  * `R2_ACCESS_KEY`
  * `R2_SECRET_KEY`

## 3. SQL Schema to Execute
Once the Supabase MCP is authenticated, we will autonomously execute the following DDL string to provision the central data table:

```sql
CREATE TABLE IF NOT EXISTS sites (
  site_no TEXT PRIMARY KEY,
  project_number TEXT,
  data JSONB NOT NULL
);

-- Optional: RLS Policies can be added here depending on public vs backend-only access needs.
```

## 4. Packages to Install
During the codebase refactoring phase, we will modify the local `package.json` to swap out the legacy local file storage and introduce the cloud SDKs:

**Packages to Add:**
* `@supabase/supabase-js` (For JSONB data interactions)
* `@aws-sdk/client-s3` (For streaming PDFs directly into Cloudflare R2)
* `serverless-http` (To wrap the existing Express.js app for Netlify Functions)

**Packages to Remove:**
* `multer` (Since we will stream to R2 rather than using local disk buffering)

## 5. Next Steps overview
1. **Wait for User Authentication:** (Current Step) 
2. **Cloud Infrastructure Setup:** Provision the Supabase table, and configure Netlify site + environment variables.
3. **Backend Refactoring:** Rip out `fs` and `multer` -> Implement `supabase-js`, `aws-sdk/client-s3`, and wrap Express with `serverless-http`. Create `netlify.toml`.
4. **Frontend Refactoring:** Route `fetch` requests to `/api/*` Netlify endpoints and parse JSONB dynamic responses.
