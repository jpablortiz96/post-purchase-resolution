/**
 * Customer Account API — OAuth 2.0 authorization code flow with PKCE.
 *
 * This app's customer authentication is a PUBLIC client: PKCE only, no client
 * secret in the customer flow. The Admin API secret is never used here.
 *
 * Endpoints are always discovered, never hardcoded.
 *
 * Serverless invocations are not guaranteed to share memory, so the short-lived
 * auth transaction (state / nonce / PKCE verifier) travels in an encrypted,
 * integrity-protected, HttpOnly cookie rather than server memory.
 */

const crypto = require('crypto');

const RAW = (process.env.SHOPIFY_SHOP || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SHOP = RAW.includes('.') ? RAW : `${RAW}.myshopify.com`;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const REDIRECT_URI = process.env.SHOPIFY_CUSTOMER_REDIRECT_URI
  || 'https://post-purchase-resolution.vercel.app/api/auth/callback';

/** Minimum scopes. `email` is deliberately not requested — nothing needs it. */
const SCOPES = 'openid customer-account-api:full';

const TXN_COOKIE = 'ppr_txn';
const SESSION_COOKIE = 'ppr_sess';
const TXN_TTL_MS = 10 * 60 * 1000;

// ── discovery ────────────────────────────────────────────────────────

let discoveryCache = null;

async function discover() {
  if (discoveryCache && Date.now() < discoveryCache.expires) return discoveryCache.value;
  const [oidcRes, caRes] = await Promise.all([
    fetch(`https://${SHOP}/.well-known/openid-configuration`),
    fetch(`https://${SHOP}/.well-known/customer-account-api`),
  ]);
  if (!oidcRes.ok || !caRes.ok) throw new AuthError('DISCOVERY_FAILED', 'Could not discover the customer authentication configuration.');
  const oidc = await oidcRes.json();
  const ca = await caRes.json();
  const value = {
    issuer: oidc.issuer,
    authorizationEndpoint: oidc.authorization_endpoint,
    tokenEndpoint: oidc.token_endpoint,
    endSessionEndpoint: oidc.end_session_endpoint,
    graphqlApi: ca.graphql_api,
  };
  discoveryCache = { value, expires: Date.now() + 10 * 60 * 1000 };
  return value;
}

class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ── cookie sealing (AES-256-GCM) ─────────────────────────────────────

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new AuthError('NO_SESSION_SECRET', 'Session storage is not configured.');
  return crypto.createHash('sha256').update(s).digest();
}

/** Encrypt + authenticate a small JSON payload for cookie transport. */
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}

/** Returns null on any tampering, truncation or wrong key. Never throws. */
function unseal(value) {
  try {
    const raw = Buffer.from(String(value || ''), 'base64url');
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const out = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAgeSec) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  bits.push(`Max-Age=${maxAgeSec}`);
  return bits.join('; ');
}

const clearCookie = name => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ── PKCE ─────────────────────────────────────────────────────────────

const b64url = buf => buf.toString('base64url');

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ── authorization request ────────────────────────────────────────────

async function buildAuthorizationUrl() {
  const d = await discover();
  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));

  const url = new URL(d.authorizationEndpoint);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  // The verifier never appears in a URL — only in the sealed cookie.
  const txn = seal({ state, nonce, verifier, exp: Date.now() + TXN_TTL_MS });
  return { url: url.toString(), txnCookie: cookie(TXN_COOKIE, txn, TXN_TTL_MS / 1000) };
}

const timingSafeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ── token exchange ───────────────────────────────────────────────────

async function exchangeCode({ code, state, req }) {
  if (!code) throw new AuthError('MISSING_CODE', 'The sign-in response was missing its authorization code.');
  if (!state) throw new AuthError('MISSING_STATE', 'The sign-in response was missing its state value.');

  const txn = unseal(parseCookies(req)[TXN_COOKIE]);
  if (!txn) throw new AuthError('NO_TRANSACTION', 'That sign-in attempt is no longer valid. Please start again.');
  if (Date.now() > txn.exp) throw new AuthError('TRANSACTION_EXPIRED', 'That sign-in attempt expired. Please start again.');
  if (!timingSafeEqual(txn.state, state)) throw new AuthError('STATE_MISMATCH', 'That sign-in attempt could not be verified. Please start again.');

  const d = await discover();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,          // public client: no secret
    redirect_uri: REDIRECT_URI,    // must match the registered URI exactly
    code,
    code_verifier: txn.verifier,
  });

  const res = await fetch(d.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // Never echo the body: it can contain credential material.
    throw new AuthError('TOKEN_EXCHANGE_FAILED', `Shopify rejected the sign-in (${res.status}).`);
  }
  const tok = await res.json();
  if (!tok.access_token) throw new AuthError('NO_ACCESS_TOKEN', 'Shopify did not return a customer token.');

  // OIDC checks. The id_token arrived directly from the issuer over TLS in a
  // back-channel exchange, so per OIDC the signature need not be re-verified
  // here; issuer, audience and nonce still must match.
  let subject = null;
  if (tok.id_token) {
    const claims = decodeJwtPayload(tok.id_token);
    if (claims) {
      if (claims.nonce && !timingSafeEqual(claims.nonce, txn.nonce)) {
        throw new AuthError('NONCE_MISMATCH', 'That sign-in could not be verified. Please start again.');
      }
      if (claims.iss && claims.iss !== d.issuer) throw new AuthError('ISSUER_MISMATCH', 'Unexpected sign-in issuer.');
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.aud && !aud.includes(CLIENT_ID)) throw new AuthError('AUDIENCE_MISMATCH', 'Unexpected sign-in audience.');
      subject = claims.sub || null;
    }
  }

  const expiresAt = Date.now() + ((tok.expires_in || 7200) * 1000);
  const sess = seal({ at: tok.access_token, exp: expiresAt, sub: subject });

  return {
    // Clearing the one-time transaction is part of the success path.
    cookies: [cookie(SESSION_COOKIE, sess, Math.floor((tok.expires_in || 7200))), clearCookie(TXN_COOKIE)],
  };
}

function decodeJwtPayload(jwt) {
  try {
    const p = String(jwt).split('.')[1];
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch (e) { return null; }
}

// ── session ──────────────────────────────────────────────────────────

/** The customer session, or null. Never leaves this process with the token. */
function getSession(req) {
  const s = unseal(parseCookies(req)[SESSION_COOKIE]);
  if (!s || !s.at) return null;
  if (Date.now() > s.exp) return null;
  return s;
}

/** Safe-to-expose view. Deliberately no token, no email, no identifiers. */
function publicSession(req) {
  const s = getSession(req);
  if (!s) return { authenticated: false };
  return { authenticated: true, expiresInSeconds: Math.max(0, Math.floor((s.exp - Date.now()) / 1000)) };
}

async function logoutRedirect() {
  const d = await discover();
  return d.endSessionEndpoint || null;
}

module.exports = {
  discover, buildAuthorizationUrl, exchangeCode, getSession, publicSession,
  logoutRedirect, parseCookies, clearCookie, seal, unseal,
  AuthError, SESSION_COOKIE, TXN_COOKIE, REDIRECT_URI, SCOPES,
  shopHost: () => SHOP,
};
