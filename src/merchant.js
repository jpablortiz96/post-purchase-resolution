/**
 * Merchant decision desk.
 *
 * Reads authoritative return state from Shopify and, on approval, calls
 * returnApproveRequest server-side. The UI is never updated optimistically:
 * after any action it re-reads external state and renders whatever Shopify says.
 */

const $ = id => document.getElementById(id);
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let busy = false;
let lastError = null;

/**
 * Merchant authority credential.
 *
 * Deliberately NOT embedded in this file — a public page cannot hold a secret.
 * The operator pastes it once per browser session and it is sent as a bearer
 * header. This is a stopgap that stops anonymous approval; it is not merchant
 * identity, and the UI says so. Real merchant sessions are tracked in
 * docs/M4_3_PREFLIGHT.md.
 */
const tokenKey = 'ppr_merchant_operator_token';
const getToken = () => { try { return sessionStorage.getItem(tokenKey) || ''; } catch (e) { return ''; } };
const setToken = v => { try { sessionStorage.setItem(tokenKey, v); } catch (e) {} };

async function load() {
  try {
    const oRes = await fetch('/api/order');
    const order = await oRes.json();
    if (!order.ok) return renderUnavailable(order.error);
    render(order.order);
  } catch (e) {
    renderUnavailable('Could not reach the commerce system.');
  }
  loadQueue();
}

/**
 * Every return in the store that is waiting on, or has had, a decision.
 *
 * A customer can raise a return against any purchase they own, so the desk
 * reads the whole queue rather than one configured order. Merchant-only data:
 * without an operator token the server refuses and this stays empty.
 */
async function loadQueue() {
  const el = $('queue');
  if (!el) return;
  // Silence is the wrong answer here. Rendering nothing without a token is
  // indistinguishable from "no returns are waiting", and a merchant reading an
  // empty page concluded exactly that while a REQUESTED return was pending.
  if (!getToken()) {
    el.innerHTML = '<div class="card"><div class="lbl">Return queue</div>' +
      '<div class="empty">Enter your operator token above to see returns waiting for a decision. ' +
      'Until then this desk shows nothing — not even an empty queue.</div></div>';
    return;
  }
  try {
    // The queue rides along with the status read, and only for a caller the
    // server accepts as the merchant.
    const r = await fetch('/api/return-status', { headers: { 'x-merchant-token': getToken() } });
    const body = await r.json();
    if (!body.ok || !body.queue) {
      el.innerHTML = '<div class="card"><div class="lbl">Return queue</div>' +
        '<div class="empty">That operator token was not accepted, so the queue could not be read.</div></div>';
      return;
    }
    const rows = body.queue;
    if (!rows.length) {
      el.innerHTML = '<div class="card"><div class="lbl">Return queue</div>' +
        '<div class="empty">No returns are waiting.</div></div>';
      return;
    }
    // Only REQUESTED is actionable. OPEN is shown for awareness without an
    // approve control, and settled returns (CLOSED / DECLINED / CANCELED) are
    // excluded by the server.
    el.innerHTML = '<div class="card"><div class="lbl">Return queue &middot; whole store</div>' +
      rows.map(r => `<div class="row">
        <div class="k">${esc(r.orderReference)} &middot; ${esc(r.reference)}</div>
        <div class="v">${esc(r.status)}${r.status === 'REQUESTED'
          ? ` <button class="btn" data-approve="${esc(r.externalId)}">Approve</button>` : ''}</div>
      </div>`).join('') + '</div>';
  } catch (e) { el.innerHTML = ''; }
}

function renderUnavailable(msg) {
  const b = $('badge');
  b.textContent = 'Shopify · Unavailable';
  b.style.cssText = 'background:rgba(225,112,85,.1);border:1px solid rgba(225,112,85,.3);color:#e17055';
  $('desk').innerHTML = `<div class="card"><div class="lbl">Live commerce</div>
    <div class="empty">${esc(msg || 'Unavailable.')}</div></div>`;
}

function render(order) {
  const returns = order.existingReturns || [];
  const pending = returns.find(r => r.status === 'REQUESTED');
  const open = returns.find(r => r.status === 'OPEN');
  const active = pending || open || null;

  const head = `
    <div class="lbl">Return request</div>
    <div class="title">${esc(order.product || '—')}</div>
    <div class="row"><div class="k">Order</div><div class="v">${esc(order.orderReference)}</div></div>
    <div class="row"><div class="k">Amount</div><div class="v">${order.price !== null && order.price !== undefined ? esc(order.price.toFixed(2) + ' ' + order.currency) : '—'}</div></div>
    <div class="row"><div class="k">Reason</div><div class="v">Damaged or defective</div></div>
    <div class="row"><div class="k">Customer note</div><div class="v">Product arrived damaged. Left earphone is not working.</div></div>
    <div class="row"><div class="k">Shopify return</div><div class="v">${active ? esc(active.reference) : '—'}</div></div>
    <div class="row"><div class="k">Shopify status</div><div class="v">
      <span class="status status--${active ? esc(active.status) : 'none'}">${active ? esc(active.status) : 'NO ACTIVE RETURN'}</span>
    </div></div>`;

  let actions;
  if (pending) {
    actions = `<div class="note">This request is waiting on you. Approving calls Shopify's
      <code>returnApproveRequest</code> and moves the return to OPEN.</div>
      <div class="acts">
        <button class="btn go" id="approve" ${busy ? 'disabled' : ''}>${busy ? 'Approving…' : '✓ Approve return'}</button>
        <button class="btn ghost" id="refresh">Refresh from Shopify</button>
      </div>`;
  } else if (open) {
    actions = `<div class="note" style="background:rgba(0,184,148,.08);border-color:rgba(0,184,148,.22);color:#9fe3cf">
      Approved. Shopify holds this return as OPEN, and the customer's page reads the same status.</div>
      <div class="acts"><button class="btn ghost" id="refresh">Refresh from Shopify</button></div>`;
  } else {
    actions = `<div class="note">No return is currently awaiting a decision on this order.</div>
      <div class="acts"><button class="btn ghost" id="refresh">Refresh from Shopify</button></div>`;
  }

  const err = lastError ? `<div class="err">${esc(lastError)}</div>` : '';

  // Only shown when a decision is actually pending and no credential is held.
  const needsToken = !!pending && !getToken();
  const tokenBox = needsToken ? `
    <div class="note" style="margin-top:16px">
      Approving is a merchant action. Paste the operator credential for this store
      to continue. It is held for this browser session only and never stored in the page source.
      <div class="acts" style="margin-top:12px">
        <input id="token-input" type="password" placeholder="Operator credential"
          style="flex:1;min-width:240px;padding:10px 13px;border-radius:9px;background:var(--raised);
                 border:1px solid var(--bd);color:var(--tx);font-family:inherit;font-size:13px">
        <button class="btn go" id="save-token">Continue</button>
      </div>
    </div>` : '';

  $('desk').innerHTML = `<div class="card">${head}${needsToken ? tokenBox : actions}${err}</div>`;
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;

  if (t.id === 'refresh') { lastError = null; return load(); }

  if (t.id === 'save-token') {
    const input = document.getElementById('token-input');
    if (input && input.value.trim()) { setToken(input.value.trim()); lastError = null; }
    return load();
  }

  if (t.dataset && t.dataset.approve) {
    if (busy) return;                    // merchant double-click guard
    busy = true; lastError = null;
    try {
      const res = await fetch('/api/return-approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-merchant-token': getToken() },
        body: JSON.stringify({ returnId: t.dataset.approve }),
      });
      const body = await res.json();
      if (!body.ok) lastError = body.error + (body.detail ? ' (' + [].concat(body.detail).join('; ') + ')' : '');
    } catch (e) {
      lastError = 'Could not reach the commerce system.';
    }
    busy = false;
    await load();                        // never optimistic: re-read Shopify
    return;
  }

  if (t.id === 'approve') {
    if (busy) return;                    // merchant double-click guard
    busy = true;
    lastError = null;
    await load();                        // re-read before mutating
    try {
      const res = await fetch('/api/return-approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-merchant-token': getToken() },
        body: '{}',
      });
      const body = await res.json();
      if (!body.ok) {
        lastError = body.error + (body.detail ? ' (' + [].concat(body.detail).join('; ') + ')' : '');
      }
    } catch (e) {
      lastError = 'Could not reach the commerce system.';
    }
    busy = false;
    // Never optimistic: what renders next comes from a fresh Shopify read.
    await load();
  }
});

load();
setInterval(() => { if (!busy) load(); }, 8000);
