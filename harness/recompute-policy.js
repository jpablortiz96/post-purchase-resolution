/**
 * Refines the policy-correctness metric and recomputes it for every recorded
 * run. The original `policyCheck` is preserved untouched; the refined result is
 * written alongside as `policyCheckV2`.
 *
 * WHY. The first version flagged three classes of legitimate number as
 * "unsupported", which made it useless for comparing modes:
 *
 *   1. numbers from the issue itself      — "arrived two days late"  (2)
 *   2. numbers quoted from the customer   — "away for three weeks"   (21)
 *   3. arithmetic over real policy values — "$89 on the table" = 129 - 40
 *
 * None of those is an invented merchant fact. V2 allows all three, applying the
 * identical rule to both modes. It stays a heuristic: it flags candidates for
 * review, it does not prove intent, and it still cannot catch an invented fact
 * expressed without a number.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'evidence', 'm2', 'runs');
const SNAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'policy-snapshot.json'), 'utf8'));

const WORD_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, twenty: 20, thirty: 30,
};

function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(\d+(?:\.\d{1,2})?)/g)) out.add(parseFloat(m[1]));
  for (const [w, v] of Object.entries(WORD_NUM)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) {
      out.add(v);
      if (/week/i.test(text)) out.add(v * 7);   // "three weeks" -> 21 days
    }
  }
  return out;
}

function allowedFor(scenarioKey, prompt) {
  const sc = SNAP[scenarioKey];
  const money = new Set([sc.order.price]);
  const days = new Set([14, 3]);   // return window + the "3–5 business days" range

  for (const o of sc.options) {
    // NB: 0 is a real policy value ("$0 refunded" for a replacement), so these
    // are added on type, not on truthiness.
    if (typeof o.economicImpact.refundToCustomer === 'number') money.add(o.economicImpact.refundToCustomer);
    if (typeof o.economicImpact.storeCreditToCustomer === 'number') money.add(o.economicImpact.storeCreditToCustomer);
    if (typeof o.timing.businessDays === 'number') days.add(o.timing.businessDays);
  }

  // (3) arithmetic an agent legitimately performs when comparing options
  const base = [...money];
  for (const a of base) for (const b of base) {
    if (a > b) money.add(Math.round((a - b) * 100) / 100);
    money.add(Math.round((a + b) * 100) / 100);
  }

  // (1) numbers stated by the merchant in the issue itself
  for (const n of numbersIn(sc.issue.description + ' ' + sc.issue.headline)) { days.add(n); money.add(n); }
  // (2) numbers the customer themselves used
  for (const n of numbersIn(prompt)) { days.add(n); money.add(n); }

  return { money, days };
}

function main() {
  const files = fs.readdirSync(RUNS).filter(f => f.endsWith('.json'));
  let changed = 0, cleanV1 = 0, cleanV2 = 0;

  for (const f of files) {
    const p = path.join(RUNS, f);
    const run = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!run.policyCheck) continue;

    const { money, days } = allowedFor(run.scenario, run.prompt);
    const badMoney = (run.policyCheck.moneyMentioned || []).filter(v => !money.has(v));
    const badDays = (run.policyCheck.daysMentioned || []).filter(v => !days.has(v));

    run.policyCheckV2 = {
      method: 'policy values + derived arithmetic + numbers from the issue and the customer prompt',
      unsupportedMoney: badMoney,
      unsupportedDays: badDays,
      unsupportedFactCount: badMoney.length + badDays.length,
      clean: badMoney.length === 0 && badDays.length === 0,
    };

    if (run.policyCheck.clean) cleanV1++;
    if (run.policyCheckV2.clean) cleanV2++;
    fs.writeFileSync(p, JSON.stringify(run, null, 2));
    changed++;
  }

  console.log(`recomputed ${changed} runs`);
  console.log(`clean under V1: ${cleanV1}`);
  console.log(`clean under V2: ${cleanV2}`);
}

main();
