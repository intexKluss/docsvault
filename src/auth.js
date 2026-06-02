// opt-in token auth. ist API_TOKEN nicht gesetzt, ist alles offen (default-verhalten).

function configuredToken() {
  const t = process.env.API_TOKEN;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

// extrahiert das praesentierte token aus Authorization-Header oder ?token= query.
// EventSource/SSE kann keine header setzen, darum auch query erlauben.
function extractToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  // express: req.query, ws-upgrade: nur raw url -> selbst parsen
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  if (typeof req.url === 'string') {
    const qIdx = req.url.indexOf('?');
    if (qIdx !== -1) {
      const params = new URLSearchParams(req.url.slice(qIdx + 1));
      const t = params.get('token');
      if (t) return t;
    }
  }
  return null;
}

// timing-safe vergleich ohne crypto-import, laenge wird vorab geprueft.
function tokensMatch(presented, expected) {
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// prueft ob die anfrage autorisiert ist. ohne konfiguriertes token immer true.
export function wsAuthOk(req) {
  const expected = configuredToken();
  if (!expected) return true;
  return tokensMatch(extractToken(req), expected);
}

// express middleware. ohne konfiguriertes token wird alles durchgewinkt.
export function requireToken(req, res, next) {
  const expected = configuredToken();
  if (!expected) return next();
  if (tokensMatch(extractToken(req), expected)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
