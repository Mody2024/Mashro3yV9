const { api, loadDb } = require('../server');

let ready;

module.exports = async function handler(req, res) {
  // Each Vercel function instance may be cold-started, so initialize the
  // persistent Supabase-backed state before serving the first request.
  if (!ready) ready = loadDb();
  try {
    await ready;
    return api(req, res);
  } catch (err) {
    console.error('[SKL27] API startup error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Server initialization failed' }));
    }
  }
};
