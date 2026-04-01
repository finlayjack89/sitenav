process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function setup() {
  const query = `
    CREATE TABLE IF NOT EXISTS sites (
      site_no TEXT PRIMARY KEY,
      project_number TEXT,
      data JSONB NOT NULL
    );
  `;
  try {
    const res = await fetch('https://api.supabase.com/v1/projects/hwxrlizvyapisruelisj/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sbp_5c76676731f7de6539aaac2de5e2bd3f12ded948',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  } catch (e) {
    console.error(e);
  }
}
setup();
