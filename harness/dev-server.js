/** Local dev server: static files + /api/* routed to the Vercel-style handlers. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.env.PORT || 3000);
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

const ROUTES = {
  '/api/order': require('../api/order.js'),
  '/api/return-request': require('../api/return-request.js'),
  '/api/return-approve': require('../api/return-approve.js'),
  '/api/return-status': require('../api/return-status.js'),
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const handler = ROUTES[u.pathname];
  if (handler) {
    req.query = Object.fromEntries(u.searchParams);
    if (req.method === 'POST') {
      let b = ''; req.on('data', c => (b += c));
      await new Promise(r => req.on('end', r));
      req.body = b;
    }
    return handler(req, res);
  }
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/merchant') p = '/merchant.html';
  const f = path.resolve(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, {'content-type':'text/plain'}).end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control':'no-store' });
    res.end(d);
  });
}).listen(PORT, () => console.log('dev server on http://localhost:' + PORT));
