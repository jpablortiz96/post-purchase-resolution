/**
 * UI + WebMCP binding.
 *
 * All policy and state truth lives in policy.js / state.js. This file only
 * renders that truth and exposes it through WebMCP.
 */

import { SCENARIOS, SCENARIO_KEYS, DEFAULT_SCENARIO, findScenarioByOrderId } from './fixtures.js';
import { ResolutionSession, STATES, TOOLS_BY_STATE } from './state.js';
import { getEligibleResolutions } from './policy.js';

const session = new ResolutionSession(DEFAULT_SCENARIO);

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

function toolDefs() {
  const order = session.order;
  const eligible = getEligibleResolutions(order, session.issue).map(o => o.id);

  const wrongOrder = (id) => id && String(id) !== order.orderId
    ? { error: 'That order is not the one open on this page', requested: String(id), openOrder: order.orderId }
    : null;

  return {
    get_order: {
      name: 'get_order',
      description:
        'Read the order currently open on this page: product, amount, fulfilment dates, ' +
        'the reported issue, relevant customer context, and the current state of any ' +
        'resolution in progress or completed. Read-only.',
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
        note('AGENT', `Inspected order #${order.orderId}`);
        return JSON.stringify(session.buildOrderPayload());
      },
    },

    get_resolution_options: {
      name: 'get_resolution_options',
      description:
        'List every resolution permitted by merchant policy for this order and issue. ' +
        'Each option states what the customer receives, its monetary effect, timing, ' +
        'whether a return is required, and availability. These are the only permitted ' +
        'resolutions — do not offer anything not in this list. Read-only.',
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
        const payload = session.buildOptionsPayload();
        note('AGENT', `Retrieved ${payload.options.length} eligible resolution option${payload.options.length === 1 ? '' : 's'}`);
        return JSON.stringify(payload);
      },
    },

    prepare_resolution: {
      name: 'prepare_resolution',
      description:
        'Stage one of the eligible resolutions for the customer to decide on. This does ' +
        'NOT issue money, ship anything, or finalise anything — it puts the chosen option ' +
        'in front of the customer for explicit approval. Supply the reason you believe ' +
        'this option best fits the customer\'s situation; it is shown to them as your reasoning.',
      inputSchema: {
        type: 'object',
        properties: {
          resolution_id: {
            type: 'string',
            enum: eligible,
            description: 'The id of an option returned by get_resolution_options.',
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

    confirm_resolution: {
      name: 'confirm_resolution',
      description:
        'Execute the resolution the customer has approved. Consequential and final. ' +
        'Supply the id of the approved resolution; if the customer changed their ' +
        'selection this call is rejected so nothing unintended is executed.',
      inputSchema: {
        type: 'object',
        properties: {
          resolution_id: {
            type: 'string',
            description: 'The id of the resolution the customer approved.',
          },
        },
        required: ['resolution_id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (args = {}) => {
        const out = session.confirm({ resolutionId: args.resolution_id, actor: 'AGENT' });
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
  const want = session.allowedTools();
  const defs = toolDefs();

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
  ['RESOLUTION_PREPARED', 'Prepared'],
  ['HUMAN_APPROVED', 'Approved'],
  ['RESOLVED', 'Resolved'],
];

function railIndex() {
  switch (session.state) {
    case STATES.ORDER_ACTIVE:
    case STATES.RESOLUTION_CANCELLED: return 0;
    case STATES.RESOLUTION_PREPARED: return 1;
    case STATES.HUMAN_APPROVED:
    case STATES.RESOLUTION_EXECUTING: return 2;
    case STATES.RESOLVED: return 3;
    default: return 0;
  }
}

function renderFixtures() {
  $('fixtures').innerHTML = SCENARIO_KEYS.map(k =>
    `<button class="fixture-btn ${k === session.scenario.key ? 'on' : ''}" data-scenario="${k}">${esc(SCENARIOS[k].label)}</button>`
  ).join('');
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
  const options = getEligibleResolutions(session.order, session.issue);

  // ── resolved ────────────────────────────────────────────────────
  if (st === STATES.RESOLVED) {
    const r = session.resolutionResult;
    el.innerHTML = `
      <div class="resolved">
        <div class="check">✓</div>
        <div class="decision-label" style="color:var(--success)">Resolution complete</div>
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
  if (st === STATES.RESOLUTION_PREPARED || st === STATES.HUMAN_APPROVED || st === STATES.RESOLUTION_EXECUTING) {
    const p = session.preparedResolution;
    const o = p.option;
    const e = o.economicImpact;
    const approved = session.humanApproved;

    const econ = [];
    if (e.refundToCustomer > 0) econ.push(`${money(e.refundToCustomer, e.currency)} refunded`);
    if (e.storeCreditToCustomer > 0) econ.push(`${money(e.storeCreditToCustomer, e.currency)} store credit`);
    if (e.replacementShipped) econ.push('Item shipped at no charge');
    if (!econ.length) econ.push('No monetary change');
    if (e.customerKeepsItem) econ.push('Customer keeps the original item');

    const reasoning = p.reason
      ? `<div class="block block--agent">
           <div class="block-tag">Agent reasoning <small>— not merchant policy</small></div>
           <p>“${esc(p.reason)}”</p>
         </div>`
      : `<div class="block block--agent">
           <div class="block-tag">Agent reasoning <small>— not merchant policy</small></div>
           <p style="font-style:normal;color:var(--text-muted)">You chose this option yourself. No agent recommendation applies.</p>
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

    const buttons = approved
      ? `<div class="approved-note">
           You approved this. It has not been carried out yet — complete it here,
           or let your assistant finalise it for you.
         </div>
         <div class="actions">
           <button class="btn btn-go" id="complete">Complete resolution now</button>
           <button class="btn btn-no" id="cancel">Cancel</button>
         </div>`
      : choosing ? '' : `<div class="actions">
           <button class="btn btn-go" id="approve">✓ Approve this resolution</button>
           <button class="btn btn-alt" id="choose">Choose another</button>
           <button class="btn btn-no" id="cancel">Cancel</button>
         </div>`;

    el.innerHTML = `
      <div class="decision">
        <div class="decision-label">${approved ? 'Approved — ready to finalise' : 'Resolution ready for your decision'}</div>
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
      <div class="head">${cancelled ? 'Resolution cancelled — options still available' : 'Resolutions available under merchant policy'}</div>
      ${options.map(o => optionRow(o, { chooseable: true })).join('')}
      <div class="opt-meta" style="margin-top:12px">
        Choose one to review it, or ask your assistant to recommend one.
        Nothing is issued until you approve it.
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

/**
 * @param deferTools  Registering or unregistering a tool synchronously from
 *   inside an execute handler interrupts the in-flight executeTool call in the
 *   browser engine (verified in M0.5). When rendering as a result of a tool
 *   call, the DOM updates immediately but the tool-set sync is scheduled so
 *   executeTool can resolve first.
 */
function render({ deferTools = false } = {}) {
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

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-scenario], [data-pick], [data-choose], button');
  if (!t) return;

  // Customer stages a resolution themselves, without an assistant.
  if (t.dataset.choose) {
    session.prepare({ resolutionId: t.dataset.choose, reason: null, actor: 'HUMAN' });
    render();
    return;
  }

  if (t.dataset.scenario) {
    session.reset(t.dataset.scenario);
    choosing = false; chosenId = null; lastCall = null;
    syncTools({ force: true });
    render();
    return;
  }

  if (t.dataset.pick) { chosenId = t.dataset.pick; renderSurface(); return; }

  switch (t.id) {
    case 'approve':
      session.approve();
      render();
      break;
    case 'complete':
      // Same guarded transition the assistant would use: it still requires
      // HUMAN_APPROVED and a matching resolution id.
      session.confirm({ resolutionId: session.preparedResolution.option.id, actor: 'HUMAN' });
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

setBadge(webmcpReady);
render();
watch();

// exposed for the browser-side WebMCP verification harness only
window.__session = session;
console.log('[Post-Purchase Resolution] M1 ready.');
