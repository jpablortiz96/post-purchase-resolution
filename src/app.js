/**
 * UI + WebMCP binding.
 *
 * All policy and state truth lives in policy.js / state.js. This file only
 * renders that truth and exposes it through WebMCP.
 */

import { SCENARIOS, SCENARIO_KEYS, DEFAULT_SCENARIO, findScenarioByOrderId } from './fixtures.js';
import { ResolutionSession, STATES, TOOLS_BY_STATE } from './state.js';
import { LiveSession, LIVE_STATES } from './live.js';

const session = new ResolutionSession(DEFAULT_SCENARIO);

// LIVE COMMERCE — a real Shopify order. The fixture scenarios remain available
// for regression; this is the hero flow.
const live = new LiveSession();
let liveMode = false;
let livePoll = null;
const isLive = () => liveMode;

let webmcpReady = 'modelContext' in document;
const controllers = {};   // toolName -> AbortController
let lastCall = null;
let choosing = false;     // "choose another" panel open
let chosenId = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n, c) => `${n.toFixed(2)} ${c}`;

// ═══════════════════════════════════════════════════════════════════
// WEBMCP
// ═══════════════════════════════════════════════════════════════════

function liveToolDefs() {
  return {
    get_order: {
      name: 'get_order',
      description:
        'Read the order the customer is currently viewing. This order lives in ' +
        'Shopify: product, amount, financial and fulfilment status, delivery, ' +
        'whether it still has returnable fulfilled items, and any return already ' +
        'open against it. Every fact comes from the merchant system of record. ' +
        'Read-only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        await live.refresh();
        note('AGENT', `Inspected Shopify order ${live.order ? live.order.orderReference : ''}`);
        // deferTools: mutating the tool set inside an execute handler
        // interrupts the in-flight executeTool call (verified in M0.5).
        renderLive({ deferTools: true });
        return JSON.stringify(live.buildOrderPayload());
      },
    },
    prepare_resolution: {
      name: 'prepare_resolution',
      description:
        'Stage a return request for the customer to review. This does NOT contact ' +
        'Shopify and creates nothing: only the customer can submit the request, and ' +
        'only the merchant can approve it. Supply the reason this fits their ' +
        'situation; it is shown to them as your reasoning.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short explanation of why a return fits this customer.' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (args = {}) => {
        const out = live.prepare({ reason: args.reason, actor: 'AGENT' });
        renderLive({ deferTools: true });
        return JSON.stringify(out.ok ? { success: true, ...out } : out);
      },
    },
  };
}

/** Which tools are valid right now in LIVE mode. Never a completion tool. */
function liveAllowedTools() {
  switch (live.state) {
    case LIVE_STATES.ORDER_ACTIVE:
      return live.order && live.order.returnable
        ? ['get_order', 'prepare_resolution'] : ['get_order'];
    case LIVE_STATES.RESOLUTION_PREPARED:
    case LIVE_STATES.RETURN_REQUESTED:
    case LIVE_STATES.RETURN_APPROVED:
      return ['get_order'];
    default:
      return [];
  }
}

function toolDefs() {
  const order = session.order;
  const eligible = session.options.map(o => o.id);

  const wrongOrder = (id) => id && String(id) !== order.orderId
    ? { error: 'That order is not the one open on this page', requested: String(id), openOrder: order.orderId }
    : null;

  return {
    get_order: {
      name: 'get_order',
      description:
        'Read the order the customer is currently viewing: product, amount, fulfilment ' +
        'dates, the reported issue, relevant customer context, the resolutions permitted ' +
        'by merchant policy, and the state of any resolution in progress or completed. ' +
        'Every amount, timing and requirement in the response is set by the merchant — ' +
        'do not offer anything that is not in resolutionOptions. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: 'Optional. Defaults to the order currently open on this page.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (args = {}) => {
        const bad = wrongOrder(args.order_id);
        if (bad) return JSON.stringify(bad);
        note('AGENT', `Inspected order #${order.orderId} and ${session.options.length} merchant-authorised options`);
        return JSON.stringify(session.buildOrderPayload());
      },
    },

    prepare_resolution: {
      name: 'prepare_resolution',
      description:
        'Stage one of the permitted resolutions for the customer to review. This does ' +
        'NOT issue money, ship anything, or complete anything: only the customer can ' +
        'complete a resolution, and they do that themselves in the page. Supply the ' +
        'reason you believe this option best fits their situation; it is shown to them ' +
        'as your reasoning, clearly separated from the merchant’s terms.',
      inputSchema: {
        type: 'object',
        properties: {
          resolution_id: {
            type: 'string',
            enum: eligible,
            description: 'The id of an option from resolutionOptions in get_order.',
          },
          reason: {
            type: 'string',
            description: 'Short explanation of why this option fits this customer.',
          },
        },
        required: ['resolution_id', 'reason'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (args = {}) => {
        const out = session.prepare({ resolutionId: args.resolution_id, reason: args.reason, actor: 'AGENT' });
        render({ deferTools: true });
        return JSON.stringify(out.ok ? { success: true, ...out } : out);
      },
    },
  };
}

function wrapExecute(def) {
  const inner = def.execute;
  return Object.assign({}, def, {
    execute: async (args) => {
      const result = await inner(args || {});
      lastCall = {
        tool: def.name,
        args: args || {},
        result: result.length > 700 ? result.slice(0, 700) + ' …' : result,
        at: new Date().toLocaleTimeString('en-US', { hour12: false }),
      };
      renderProtocol();
      return result;
    },
  });
}

async function registerTool(def) {
  const name = def.name;
  if (controllers[name]) return;
  const controller = new AbortController();
  controllers[name] = controller;

  if (!webmcpReady) return;
  try {
    await document.modelContext.registerTool(wrapExecute(def), { signal: controller.signal });
    console.log(`[WebMCP] registered: ${name}`);
  } catch (err) {
    console.error(`[WebMCP] failed to register ${name}:`, err);
  }
}

function unregisterTool(name) {
  const c = controllers[name];
  if (!c) return;
  c.abort();
  delete controllers[name];
  console.log(`[WebMCP] unregistered: ${name}`);
}

/**
 * Bring the registered tool set in line with what the current state permits.
 * Agents must only ever see tools that are valid right now.
 */
function syncTools({ force = false } = {}) {
  const want = isLive() ? liveAllowedTools() : session.allowedTools();
  const defs = isLive() ? liveToolDefs() : toolDefs();

  for (const name of Object.keys(controllers)) {
    if (force || !want.includes(name)) unregisterTool(name);
  }
  for (const name of want) {
    if (!controllers[name]) registerTool(defs[name]);
  }
}

// ═══════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════

const RAIL = [
  ['ORDER_ACTIVE', 'Issue'],
  ['RESOLUTION_PREPARED', 'Ready for you'],
  ['RESOLVED', 'Done'],
];

function railIndex() {
  switch (session.state) {
    case STATES.ORDER_ACTIVE:
    case STATES.RESOLUTION_CANCELLED: return 0;
    case STATES.RESOLUTION_PREPARED: return 1;
    case STATES.RESOLVED: return 2;
    default: return 0;
  }
}

function renderFixtures() {
  const liveBtn = `<button class="fixture-btn fixture-btn--live ${isLive() ? 'on' : ''}" data-scenario="live">● Live Shopify order</button>`;
  const fixtures = SCENARIO_KEYS.map(k =>
    `<button class="fixture-btn ${!isLive() && k === session.scenario.key ? 'on' : ''}" data-scenario="${k}">${esc(SCENARIOS[k].label)}</button>`
  ).join('');
  $('fixtures').innerHTML = liveBtn + fixtures;
  const lbl = document.querySelector('.fixtures-label');
  if (lbl) lbl.textContent = isLive()
    ? 'Live commerce — a real order in a Shopify development store'
    : 'Demo fixture — pick a scenario';
}

function renderRail() {
  const idx = railIndex();
  $('rail').innerHTML = RAIL.map((s, i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : '';
    const step = `<div class="step ${cls}"><div class="dot"></div><span>${s[1]}</span></div>`;
    return i < RAIL.length - 1 ? step + `<div class="conn ${i < idx ? 'done' : ''}"></div>` : step;
  }).join('');
}

function renderOrder() {
  const o = session.order, iss = session.issue, ctx = session.scenario.customerContext;
  const st = session.state;
  const pill = st === STATES.RESOLVED
    ? '<div class="pill pill--done">Resolved</div>'
    : (st === STATES.ORDER_ACTIVE || st === STATES.RESOLUTION_CANCELLED)
      ? `<div class="pill pill--issue">${esc(iss.headline)}</div>`
      : '<div class="pill pill--working">Resolving</div>';

  const variant = o.orderedVariant
    ? `<div class="opt-meta">Ordered ${esc(o.orderedVariant)} · received ${esc(o.receivedVariant)}</div>` : '';

  $('order-card').innerHTML = `
    <div class="order-top">
      <div class="order-id">Order #${esc(o.orderId)}</div>
      ${pill}
    </div>
    <div class="product">${esc(o.product)}</div>
    <div class="price">${esc(money(o.price, o.currency))}</div>
    ${variant}
    ${st === STATES.RESOLVED ? '' : `
      <div class="note note--issue"><span class="note-ico">⚠</span><span>${esc(iss.description)}</span></div>
      <div class="note note--ctx"><span class="note-ico">⏱</span><span>${esc(ctx.summary)}</span></div>
    `}
  `;
}

function optionRow(o, { pickable = false, selected = false, chooseable = false } = {}) {
  const e = o.economicImpact;
  const bits = [];
  if (e.refundToCustomer > 0) bits.push(`${money(e.refundToCustomer, e.currency)} back`);
  if (e.storeCreditToCustomer > 0) bits.push(`${money(e.storeCreditToCustomer, e.currency)} credit`);
  if (e.replacementShipped) bits.push('item shipped');
  if (e.customerKeepsItem) bits.push('keeps item');
  bits.push(o.returnRequired ? 'return required' : 'no return');

  const reqs = o.requirements.length
    ? `<div class="opt-meta">${o.requirements.map(esc).join(' · ')}</div>` : '';

  // A customer must be able to start a resolution without an assistant.
  const choose = chooseable
    ? `<div class="opt-action"><button class="btn btn-alt" data-choose="${o.id}">Choose this</button></div>` : '';

  return `
    <div class="opt ${pickable ? 'opt--pick' : ''} ${selected ? 'opt--sel' : ''}" ${pickable ? `data-pick="${o.id}"` : ''}>
      <div class="opt-top">
        <div class="opt-name">${esc(o.label)}</div>
        <div class="opt-timing">${esc(o.timing.summary)}</div>
      </div>
      <div class="opt-recv">${esc(o.customerReceives)}</div>
      <div class="opt-meta">${esc(bits.join(' · '))}</div>
      ${reqs}
      ${choose}
    </div>`;
}

function renderSurface() {
  const st = session.state;
  const el = $('surface');
  const options = session.options;

  // ── resolved ────────────────────────────────────────────────────
  if (st === STATES.RESOLVED) {
    const r = session.resolutionResult;
    el.innerHTML = `
      <div class="resolved">
        <div class="check">✓</div>
        <div class="decision-label" style="color:var(--success)">Done</div>
        <div class="decision-title">${esc(session.preparedResolution.option.label)}</div>
        <div class="decision-recv">${esc(r.customerReceives)}</div>
        <div class="block block--merchant">
          <div class="block-tag">Merchant record</div>
          <div class="terms">
            <div class="term"><div class="term-k">Timing</div><div class="term-v">${esc(r.timing.summary)}</div></div>
            ${r.requirements.length ? `<div class="term"><div class="term-k">Next steps</div><div class="term-v"><ul>${r.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : ''}
          </div>
        </div>
        <div class="ref">Reference: ${esc(r.referenceId)}</div>
      </div>`;
    return;
  }

  // ── decision card (hero) ────────────────────────────────────────
  if (st === STATES.RESOLUTION_PREPARED) {
    const p = session.preparedResolution;
    const o = p.option;
    const e = o.economicImpact;

    const econ = [];
    if (e.refundToCustomer > 0) econ.push(`${money(e.refundToCustomer, e.currency)} refunded`);
    if (e.storeCreditToCustomer > 0) econ.push(`${money(e.storeCreditToCustomer, e.currency)} store credit`);
    if (e.replacementShipped) econ.push('Item shipped at no charge');
    if (!econ.length) econ.push('No monetary change');
    if (e.customerKeepsItem) econ.push('You keep the original item');

    const byAgent = p.preparedBy === 'AGENT';
    const reasoning = byAgent && p.reason
      ? `<div class="block block--agent">
           <div class="block-tag">Your assistant’s reasoning <small>— not merchant policy</small></div>
           <p>“${esc(p.reason)}”</p>
         </div>`
      : `<div class="block block--agent">
           <div class="block-tag">Your choice <small>— no assistant recommendation applies</small></div>
           <p style="font-style:normal;color:var(--text-muted)">You picked this option yourself.</p>
         </div>`;

    const chooser = choosing
      ? `<div style="margin-top:16px">
           <div class="head">Every option permitted by merchant policy</div>
           ${options.map(x => optionRow(x, { pickable: true, selected: (chosenId || o.id) === x.id })).join('')}
           <div class="actions">
             <button class="btn btn-go" id="use-choice">Use this option</button>
             <button class="btn btn-alt" id="cancel-choice">Back</button>
           </div>
         </div>`
      : '';

    const buttons = choosing ? '' : `
      <div class="commit-note">
        Nothing has been issued yet. Completing this is your decision, and only you can make it.
      </div>
      <div class="actions">
        <button class="btn btn-go" id="commit">✓ Approve &amp; complete</button>
        <button class="btn btn-alt" id="choose">Choose another</button>
        <button class="btn btn-no" id="cancel">Cancel</button>
      </div>`;

    el.innerHTML = `
      <div class="decision">
        <div class="decision-label">Ready for your decision</div>
        <div class="decision-title">${esc(o.label)}</div>
        <div class="decision-recv">${esc(o.customerReceives)}</div>

        ${reasoning}

        <div class="block block--merchant">
          <div class="block-tag">Merchant terms <small>— fixed by policy</small></div>
          <div class="terms">
            <div class="term"><div class="term-k">You receive</div><div class="term-v">${esc(o.customerReceives)}</div></div>
            <div class="term"><div class="term-k">Money</div><div class="term-v">${esc(econ.join(' · '))}</div></div>
            <div class="term"><div class="term-k">Timing</div><div class="term-v">${esc(o.timing.summary)}</div></div>
            <div class="term"><div class="term-k">Return</div><div class="term-v">${o.returnRequired ? 'Required' : 'Not required'}</div></div>
            ${o.requirements.length ? `<div class="term"><div class="term-k">Requirements</div><div class="term-v"><ul>${o.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : ''}
          </div>
        </div>

        ${buttons}
        ${chooser}
      </div>`;
    return;
  }

  // ── no resolution staged yet ────────────────────────────────────
  const cancelled = st === STATES.RESOLUTION_CANCELLED;
  el.innerHTML = `
    <section class="card">
      <div class="head">${cancelled ? 'Cancelled — these options are still available' : 'What this merchant can do for you'}</div>
      ${options.map(o => optionRow(o, { chooseable: true })).join('')}
      <div class="opt-meta" style="margin-top:12px">
        Choose one to review it, or ask your assistant to recommend one.
        Nothing is issued until you complete it yourself.
      </div>
    </section>`;
}

function renderAudit() {
  const el = $('audit');
  if (!session.audit.length) {
    el.innerHTML = '<div class="empty">No activity yet</div>';
    return;
  }
  el.innerHTML = session.audit.map(e => {
    const t = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
    return `<div class="entry">
      <span class="who who--${esc(e.actor)}">${esc(e.actor)}</span>
      <span class="what">${esc(e.action)}</span>
      <span class="when">${esc(t)}</span>
    </div>`;
  }).join('');
}

function renderProtocol() {
  const active = session.allowedTools().filter(n => controllers[n]);
  $('tool-chips').innerHTML = active.length
    ? active.map(n => {
        const ro = n.startsWith('get_');
        return `<span class="chip ${ro ? 'chip--r' : 'chip--w'}">${esc(n)}<span style="opacity:.6;font-size:10px">${ro ? 'read' : 'write'}</span></span>`;
      }).join('')
    : '<span class="opt-meta">No tools registered.</span>';

  $('lifecycle').innerHTML = Object.entries(TOOLS_BY_STATE).map(([st, tools]) =>
    `<div style="${st === session.state ? 'color:var(--accent-light);font-weight:600' : ''}">
       ${esc(st)} → ${esc(tools.join(', '))}
     </div>`).join('');

  $('last-call').textContent = lastCall
    ? `${lastCall.at}  ${lastCall.tool}\nargs   ${JSON.stringify(lastCall.args)}\nresult ${lastCall.result}`
    : 'No tool calls yet.';
}

// ═══════════════════════════════════════════════════════════════════
// LIVE COMMERCE RENDER
// ═══════════════════════════════════════════════════════════════════

const LIVE_RAIL = [
  [LIVE_STATES.ORDER_ACTIVE, 'Order'],
  [LIVE_STATES.RESOLUTION_PREPARED, 'Ready for you'],
  [LIVE_STATES.RETURN_REQUESTED, 'Requested'],
  [LIVE_STATES.RETURN_APPROVED, 'Approved'],
];

function liveRailIndex() {
  const i = LIVE_RAIL.findIndex(([k]) => k === live.state);
  return i < 0 ? 0 : i;
}

function renderLive({ deferTools = false } = {}) {
  renderFixtures();

  // The fixture disclaimer is false in live mode. Say what is actually true.
  const foot = $('foot-txt');
  if (foot) foot.textContent =
    'Live Shopify development store. Returns created here are real Shopify Return objects; ' +
    'test payments only, so no real money moves and no real customer is involved.';

  const idx = liveRailIndex();
  $('rail').innerHTML = LIVE_RAIL.map(([, label], i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : '';
    const step = `<div class="step ${cls}"><div class="dot"></div><span>${esc(label)}</span></div>`;
    return i < LIVE_RAIL.length - 1 ? step + `<div class="conn ${i < idx ? 'done' : ''}"></div>` : step;
  }).join('');

  // In live mode the merchant is a real third authority, so it gets a card.
  const auth = document.querySelector('.authority');
  if (auth) auth.innerHTML = `
    <div class="auth-card auth-card--agent"><h3>Your assistant can</h3>
      <p>Read this Shopify order and get a return request ready for you.</p></div>
    <div class="auth-card auth-card--you"><h3>Only you can</h3>
      <p>Submit the request. It creates a real return in Shopify.</p></div>
    <div class="auth-card auth-card--merchant"><h3>Only the merchant can</h3>
      <p>Approve it. Shopify holds that decision, not this page.</p></div>`;

  const o = live.order;
  if (live.state === LIVE_STATES.UNAVAILABLE || !o) {
    $('order-card').innerHTML = `<div class="order-top"><div class="order-id">Live commerce</div>
      <div class="pill pill--issue">Unavailable</div></div>
      <div class="opt-meta" style="margin-top:10px">${esc(live.error || 'Loading…')}</div>`;
    $('surface').innerHTML = '';
    renderLiveAudit();
    return;
  }

  const active = live.activeReturn;
  const pill = active
    ? `<div class="pill ${active.status === 'OPEN' ? 'pill--done' : 'pill--working'}">${esc(active.status)}</div>`
    : '<div class="pill pill--issue">Damaged</div>';

  $('order-card').innerHTML = `
    <div class="order-top">
      <div class="order-id">Shopify order ${esc(o.orderReference)}</div>
      ${pill}
    </div>
    <div class="product">${esc(o.product)}</div>
    <div class="price">${o.price != null ? esc(o.price.toFixed(2) + ' ' + o.currency) : ''}</div>
    <div class="opt-meta">${esc(o.financialStatus)} · ${esc(o.fulfillmentStatus)}${o.deliveredAt ? ' · delivered ' + esc(o.deliveredAt.slice(0, 10)) : ''}</div>
    <div class="note note--issue"><span class="note-ico">⚠</span><span>Product arrived damaged. Left earphone is not working.</span></div>`;

  const el = $('surface');

  if (active) {
    const approved = active.status === 'OPEN';
    el.innerHTML = `
      <div class="${approved ? 'resolved' : 'decision'}">
        ${approved ? '<div class="check">✓</div>' : ''}
        <div class="decision-label" ${approved ? 'style="color:var(--success)"' : ''}>
          ${approved ? 'Return approved by the merchant' : 'Return requested — waiting for the merchant'}</div>
        <div class="decision-title">Return ${esc(o.product)}</div>
        <div class="decision-recv">${esc(live.statusLabel() || '')}</div>
        <div class="block block--merchant">
          <div class="block-tag">Shopify · system of record</div>
          <div class="terms">
            <div class="term"><div class="term-k">Return</div><div class="term-v">${esc(active.reference)}</div></div>
            <div class="term"><div class="term-k">Status</div><div class="term-v"><code>${esc(active.status)}</code></div></div>
            <div class="term"><div class="term-k">Order status</div><div class="term-v">${esc(o.orderReturnStatus)}</div></div>
          </div>
        </div>
        <div class="opt-meta" style="margin-top:12px">
          This status is read from Shopify, not from this page. Reload and it is still true.
        </div>
      </div>`;
  } else if (live.state === LIVE_STATES.RESOLUTION_PREPARED) {
    const p = live.preparedResolution;
    const reasoning = p.reason
      ? `<div class="block block--agent">
           <div class="block-tag">Your assistant&rsquo;s reasoning <small>&mdash; not merchant policy</small></div>
           <p>&ldquo;${esc(p.reason)}&rdquo;</p></div>`
      : '';
    el.innerHTML = `
      <div class="decision">
        <div class="decision-label">Ready for your decision</div>
        <div class="decision-title">${esc(p.label)}</div>
        <div class="decision-recv">A return authorised by the merchant, then a refund once received</div>
        ${reasoning}
        <div class="block block--merchant">
          <div class="block-tag">What will happen <small>&mdash; in Shopify</small></div>
          <div class="terms">
            <div class="term"><div class="term-k">Action</div><div class="term-v">Create a return request in Shopify</div></div>
            <div class="term"><div class="term-k">Reason</div><div class="term-v">Damaged or defective</div></div>
            <div class="term"><div class="term-k">Quantity</div><div class="term-v">${esc(p.quantity)}</div></div>
            <div class="term"><div class="term-k">Then</div><div class="term-v">Status <code>REQUESTED</code> until the merchant approves it</div></div>
          </div>
        </div>
        <div class="commit-note">Nothing has been sent yet. Submitting this creates a real return in Shopify.</div>
        <div class="actions">
          <button class="btn btn-go" id="request-return">Request return</button>
          <button class="btn btn-no" id="live-cancel">Cancel</button>
        </div>
        <div id="live-error"></div>
      </div>`;
  } else {
    const returnable = o.returnable;
    const offer = returnable
      ? `<div class="opt"><div class="opt-top"><div class="opt-name">Return ${esc(o.product)}</div>
           <div class="opt-timing">Needs merchant approval</div></div>
           <div class="opt-recv">A return authorised by the merchant, then a refund once received</div>
           <div class="opt-meta">Reason: damaged or defective &middot; ${esc(o.returnableQuantity)} item</div>
           <div class="opt-action"><button class="btn btn-alt" id="live-choose">Choose this</button></div>
         </div>`
      : `<div class="opt-meta">Shopify reports no returnable fulfilled items for ${esc(o.orderReference)}.
           ${(o.existingReturns || []).length ? 'A return already exists against it.' : ''}</div>`;
    el.innerHTML = `
      <section class="card">
        <div class="head">${returnable ? 'What you can do with this order' : 'This order has no returnable items'}</div>
        ${offer}
        <div class="opt-meta" style="margin-top:12px">
          Merchant policy lives in Shopify. This page reads it; it does not decide it.
        </div>
      </section>`;
  }

  renderLiveAudit();
  if (deferTools) setTimeout(() => { syncTools(); renderProtocol(); }, 50);
  else { syncTools(); renderProtocol(); }
}

function renderLiveAudit() {
  const el = $('audit');
  if (!live.audit.length) { el.innerHTML = '<div class="empty">No activity yet</div>'; return; }
  el.innerHTML = live.audit.map(e => {
    const t = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
    return `<div class="entry">
      <span class="who who--${esc(e.actor)}">${esc(e.actor)}</span>
      <span class="what">${esc(e.action)}</span>
      <span class="when">${esc(t)}</span></div>`;
  }).join('');
}

/**
 * @param deferTools  Registering or unregistering a tool synchronously from
 *   inside an execute handler interrupts the in-flight executeTool call in the
 *   browser engine (verified in M0.5). When rendering as a result of a tool
 *   call, the DOM updates immediately but the tool-set sync is scheduled so
 *   executeTool can resolve first.
 */
function render({ deferTools = false } = {}) {
  if (isLive()) return renderLive({ deferTools });
  const foot = $('foot-txt');
  if (foot) foot.textContent =
    'Deterministic merchant fixtures implementing realistic post-purchase policies. ' +
    'Resolution execution is real within this application’s state machine; ' +
    'no external commerce system is connected in this mode.';
  renderFixtures();
  renderRail();
  renderOrder();
  renderSurface();
  renderAudit();
  if (deferTools) {
    setTimeout(() => { syncTools(); renderProtocol(); }, 50);
  } else {
    syncTools();
    renderProtocol();
  }
}

// ═══════════════════════════════════════════════════════════════════
// HUMAN ACTIONS
// ═══════════════════════════════════════════════════════════════════

function note(actor, action, metadata) {
  session.log(actor, action, metadata);
  renderAudit();
}

async function handleLiveClick(id) {
  if (id === 'live-choose') {
    live.prepare({ reason: null, actor: 'CUSTOMER' });
    renderLive();
    return true;
  }
  if (id === 'live-cancel') {
    live.preparedResolution = null;
    await live.refresh();
    renderLive();
    return true;
  }
  if (id === 'request-return') {
    const btn = document.getElementById('request-return');
    if (btn) { btn.disabled = true; btn.textContent = 'Requesting…'; }   // double-click guard
    const out = await live.requestReturn();
    if (!out.ok) {
      renderLive();
      const box = document.getElementById('live-error');
      if (box) {
        box.innerHTML = '<div class="commit-note" style="background:rgba(225,112,85,.1);' +
          'border-color:rgba(225,112,85,.25);color:#f0b8a4">' + esc(out.error || 'Could not create the return.') +
          (out.detail ? ' (' + esc([].concat(out.detail).join('; ')) + ')' : '') + '</div>';
      }
    } else {
      renderLive();
    }
    return true;
  }
  return false;
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-scenario], [data-pick], [data-choose], button');
  if (!t) return;

  if (isLive() && t.id && t.id !== 'reset' && !t.dataset.scenario) {
    handleLiveClick(t.id);
    return;
  }

  // Customer stages a resolution themselves, without an assistant.
  if (t.dataset.choose) {
    session.prepare({ resolutionId: t.dataset.choose, reason: null, actor: 'CUSTOMER' });
    render();
    return;
  }

  if (t.dataset.scenario === 'live') {
    enterLiveMode();
    return;
  }

  if (t.dataset.scenario) {
    leaveLiveMode();
    session.reset(t.dataset.scenario);
    choosing = false; chosenId = null; lastCall = null;
    syncTools({ force: true });
    render();
    return;
  }

  if (t.dataset.pick) { chosenId = t.dataset.pick; renderSurface(); return; }

  switch (t.id) {
    case 'commit':
      // The one consequential act. Approve and execute together, by the
      // customer, in the product. There is no agent-callable equivalent.
      session.commit({ resolutionId: session.preparedResolution.option.id, actor: 'CUSTOMER' });
      render();
      break;
    case 'cancel':
      session.cancel();
      choosing = false; chosenId = null;
      render();
      break;
    case 'choose':
      choosing = true;
      chosenId = session.preparedResolution.option.id;
      renderSurface();
      break;
    case 'cancel-choice':
      choosing = false; chosenId = null;
      renderSurface();
      break;
    case 'use-choice':
      if (chosenId && chosenId !== session.preparedResolution.option.id) session.chooseAnother(chosenId);
      choosing = false; chosenId = null;
      render();
      break;
    case 'reset':
      if (isLive()) { live.refresh().then(() => renderLive()); return; }
      session.reset(session.scenario.key);
      choosing = false; chosenId = null; lastCall = null;
      syncTools({ force: true });
      render();
      break;
  }
});

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════

function setBadge(active) {
  const b = $('badge');
  b.textContent = active ? 'WebMCP Active' : 'WebMCP Standby';
  if (!active) {
    b.style.borderColor = 'rgba(255,255,255,0.12)';
    b.style.color = 'var(--text-muted)';
    b.style.background = 'transparent';
  } else {
    b.style.borderColor = ''; b.style.color = ''; b.style.background = '';
  }
}

function attach() {
  if (webmcpReady) return true;
  if (!('modelContext' in document)) return false;
  webmcpReady = true;
  setBadge(true);
  document.modelContext.addEventListener('toolchange', () => {
    console.log('[WebMCP:toolchange]', JSON.stringify({ state: session.state, tools: session.allowedTools() }));
  });
  syncTools({ force: true });   // re-register everything against the real runtime
  renderProtocol();
  return true;
}

function watch(timeoutMs = 15000) {
  if (attach()) return;
  const started = Date.now();
  const timer = setInterval(() => {
    if (attach() || Date.now() - started > timeoutMs) clearInterval(timer);
  }, 150);
}

// ── live mode entry / exit ────────────────────────────────────────

async function enterLiveMode() {
  liveMode = true;
  choosing = false; chosenId = null; lastCall = null;
  syncTools({ force: true });
  renderLive();
  await live.refresh();
  renderLive();
  // The merchant may approve at any time; discover it by re-reading Shopify.
  if (livePoll) clearInterval(livePoll);
  livePoll = setInterval(async () => {
    if (!isLive()) return;
    const before = live.activeReturn ? live.activeReturn.status : null;
    await live.refresh();
    const after = live.activeReturn ? live.activeReturn.status : null;
    if (before !== after) {
      if (after === 'OPEN') live.log('MERCHANT', `Merchant approved ${live.activeReturn.reference} — Shopify status OPEN`);
      renderLive();
    }
  }, 6000);
}

function leaveLiveMode() {
  liveMode = false;
  if (livePoll) { clearInterval(livePoll); livePoll = null; }
  syncTools({ force: true });
}

setBadge(webmcpReady);

// Live commerce is the hero flow when the backend is configured; fall back to
// fixtures if it is not. ?mode=fixtures forces the deterministic scenarios,
// which is how the M0-M3 regression suites keep running unchanged.
(async () => {
  const forceFixtures = new URLSearchParams(location.search).get('mode') === 'fixtures';
  if (!forceFixtures) {
    try {
      const r = await fetch('/api/order');
      const b = await r.json();
      if (b.ok) { await enterLiveMode(); return; }
    } catch (e) { /* fall through to fixtures */ }
  }
  render();
})();

watch();

// exposed for the browser-side WebMCP verification harness only
window.__session = session;
console.log('[Post-Purchase Resolution] M1 ready.');
