/**
 * Generates evidence/m2/plots/*.svg from the run records.
 * Deliberately plain: bars are drawn to scale from measured values, with the
 * value printed next to each bar so the picture cannot overstate the data.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'evidence', 'm2', 'runs');
const PLOTS = path.join(ROOT, 'evidence', 'm2', 'plots');
fs.mkdirSync(PLOTS, { recursive: true });

const runs = fs.readdirSync(RUNS).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')))
  .filter(r => r.pattern === 'C');

const w = runs.filter(r => r.mode === 'webmcp');
const b = runs.filter(r => r.mode === 'baseline');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Grouped horizontal bars: one group per metric, two bars (baseline, webmcp). */
function barChart({ title, subtitle, groups, max, unit = '' }) {
  const W = 720, rowH = 54, top = 96, pad = 24;
  const H = top + groups.length * rowH + 56;
  const labelW = 250, barX = labelW + pad, barW = W - barX - 90;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d0d12"/>`,
    `<text x="${pad}" y="34" fill="#f0f0f5" font-size="17" font-weight="700">${esc(title)}</text>`,
    `<text x="${pad}" y="56" fill="#7a7a8c" font-size="12">${esc(subtitle)}</text>`,
    `<rect x="${pad}" y="70" width="11" height="11" rx="2" fill="#e17055"/>`,
    `<text x="${pad + 17}" y="80" fill="#b8b8c8" font-size="11">Human UI / browser</text>`,
    `<rect x="${pad + 150}" y="70" width="11" height="11" rx="2" fill="#6c5ce7"/>`,
    `<text x="${pad + 167}" y="80" fill="#b8b8c8" font-size="11">WebMCP</text>`,
  ];

  groups.forEach((g, i) => {
    const y = top + i * rowH;
    const scale = v => (max === 0 ? 0 : Math.max(0, (v / max) * barW));
    parts.push(`<text x="${pad}" y="${y + 17}" fill="#b8b8c8" font-size="12.5">${esc(g.label)}</text>`);
    parts.push(`<rect x="${barX}" y="${y + 4}" width="${scale(g.baseline)}" height="15" rx="3" fill="#e17055"/>`);
    parts.push(`<text x="${barX + scale(g.baseline) + 7}" y="${y + 16}" fill="#f0f0f5" font-size="11.5">${g.baseline}${unit}</text>`);
    parts.push(`<rect x="${barX}" y="${y + 23}" width="${scale(g.webmcp)}" height="15" rx="3" fill="#6c5ce7"/>`);
    parts.push(`<text x="${barX + scale(g.webmcp) + 7}" y="${y + 35}" fill="#f0f0f5" font-size="11.5">${g.webmcp}${unit}</text>`);
  });

  parts.push(`<text x="${pad}" y="${H - 18}" fill="#7a7a8c" font-size="10.5">n=${b.length} baseline, n=${w.length} WebMCP · matched intents · generated from raw run records</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

const count = (rs, fn) => rs.filter(fn).length;

// ── outcomes ────────────────────────────────────────────────────────
const outcomes = [
  { label: 'Successful resolutions', baseline: count(b, r => r.success), webmcp: count(w, r => r.success) },
  { label: 'Policy-clean runs', baseline: count(b, r => r.policyCheckV2 && r.policyCheckV2.clean), webmcp: count(w, r => r.policyCheckV2 && r.policyCheckV2.clean) },
  { label: 'Approval violations', baseline: b.reduce((n, r) => n + (r.approvalViolations || 0), 0), webmcp: w.reduce((n, r) => n + (r.approvalViolations || 0), 0) },
  { label: 'Finalised before approval', baseline: count(b, r => r.finalizedBeforeApproval), webmcp: count(w, r => r.finalizedBeforeApproval) },
  { label: 'Invalid action attempts', baseline: b.reduce((n, r) => n + (r.invalidActions || 0), 0), webmcp: w.reduce((n, r) => n + (r.invalidActions || 0), 0) },
];
fs.writeFileSync(path.join(PLOTS, 'outcomes.svg'), barChart({
  title: 'Customer outcomes and control',
  subtitle: 'Same live product, matched customer intents, approval pattern C',
  groups: outcomes,
  max: Math.max(...outcomes.flatMap(g => [g.baseline, g.webmcp]), 1),
}));

// ── effort ──────────────────────────────────────────────────────────
const med = (rs, f) => {
  const v = rs.map(f).filter(x => typeof x === 'number' && !isNaN(x)).sort((a, b2) => a - b2);
  return v.length ? Math.round(v[Math.floor(v.length / 2)]) : 0;
};
const effort = [
  { label: 'Median customer turns', baseline: med(b, r => r.customerTurns), webmcp: med(w, r => r.customerTurns) },
  { label: 'Median agent tool calls', baseline: med(b, r => r.agentToolCalls), webmcp: med(w, r => r.agentToolCalls) },
  { label: 'Median seconds to prepared', baseline: med(b, r => r.msToPrepared / 1000), webmcp: med(w, r => r.msToPrepared / 1000) },
  { label: 'Median seconds to final', baseline: med(b, r => r.msToFinal / 1000), webmcp: med(w, r => r.msToFinal / 1000) },
];
fs.writeFileSync(path.join(PLOTS, 'effort.svg'), barChart({
  title: 'Customer effort and latency',
  subtitle: 'Lower is better. Timings are dominated by model latency, not the product.',
  groups: effort,
  max: Math.max(...effort.flatMap(g => [g.baseline, g.webmcp]), 1),
}));

console.log('wrote plots:', fs.readdirSync(PLOTS).join(', '));
