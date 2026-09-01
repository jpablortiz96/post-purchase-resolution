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

async function load() {
  try {
    const oRes = await fetch('/api/order');
    const order = await oRes.json();
    if (!order.ok) return renderUnavailable(order.error);
    render(order.order);
  } catch (e) {
    renderUnavailable('Could not reach the commerce system.');
  }
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
  $('desk').innerHTML = `<div class="card">${head}${actions}${err}</div>`;
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;

  if (t.id === 'refresh') { lastError = null; return load(); }

  if (t.id === 'approve') {
    if (busy) return;                    // merchant double-click guard
    busy = true;
    lastError = null;
    await load();                        // re-read before mutating
    try {
      const res = await fetch('/api/return-approve', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
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
