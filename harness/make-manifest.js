/**
 * Writes evidence/m2/manifest.json — an inventory of the evidence with a
 * content hash per file, so any later edit is detectable.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const M2 = path.join(ROOT, 'evidence', 'm2');

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, base));
    else if (entry.name !== 'manifest.json') {
      const buf = fs.readFileSync(p);
      out.push({
        file: path.relative(base, p).replace(/\\/g, '/'),
        bytes: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const files = walk(M2);
const runs = files.filter(f => f.file.startsWith('runs/') && f.file.endsWith('.json') && !f.file.includes('/streams/'));
const streams = files.filter(f => f.file.includes('runs/streams/'));

const manifest = {
  generatedAt: new Date().toISOString(),
  productionUrl: 'https://post-purchase-resolution.vercel.app/',
  counts: {
    files: files.length,
    runRecords: runs.length,
    rawAgentStreams: streams.length,
  },
  provenance: {
    rawEvidence: 'runs/*.json and runs/streams/*.jsonl are written once per run and never edited; run-evals.js refuses to overwrite without --force.',
    reports: 'reports/, failures/, approval-study/ and plots/ are regenerated from the run records by harness/make-m2-report.js, harness/make-plots.js and harness/make-manifest.js.',
    policyMetric: 'policyCheck is the first-pass metric, kept for audit. policyCheckV2 is the refined metric added by harness/recompute-policy.js and applied identically to both modes.',
  },
  reproduce: [
    'node harness/bridge-m1.js            # one per mode, own port and OUT_DIR',
    'node harness/run-evals.js --mode webmcp   --pattern C',
    'node harness/run-evals.js --mode baseline --pattern C',
    'node harness/recompute-policy.js',
    'node harness/make-m2-report.js',
    'node harness/make-plots.js',
  ],
  files,
};

fs.writeFileSync(path.join(M2, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`manifest: ${files.length} files, ${runs.length} run records, ${streams.length} raw streams`);
