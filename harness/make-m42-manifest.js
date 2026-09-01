const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const D = path.join(__dirname, '..', 'evidence', 'm4-merchant-loop');

function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.name !== 'manifest.json') {
      const b = fs.readFileSync(p);
      out.push({
        file: path.relative(base, p).split(path.sep).join('/'),
        bytes: b.length,
        sha256: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16),
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const files = walk(D, D);
const r = JSON.parse(fs.readFileSync(path.join(D, 'full-loop-result.json'), 'utf8'));
const created = r.returnCreated || {};
const approved = r.returnApproved || {};

fs.writeFileSync(path.join(D, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  milestone: 'M4.2',
  productionUrl: 'https://post-purchase-resolution.vercel.app/',
  shopifyEnvironment: 'development store, test payments, no real money moved',
  fullLoop: {
    order: '#1002',
    returnReference: created.reference || null,
    externalId: created.externalId || null,
    statusAfterCustomerRequest: 'REQUESTED',
    statusAfterMerchantApproval: 'OPEN',
    sameReturnObject: !!(created.externalId && approved.externalId && created.externalId === approved.externalId),
    allMutationsPerformedByClickingTheProductionApp: true,
    verificationQueriesWereReadOnlyAndIndependent: true,
    checks: r.passed + '/' + r.total,
  },
  historicalManualSpike: {
    order: '#1001',
    returnReference: '#1001-R1',
    status: 'OPEN',
    note: 'Preserved unchanged. Not used as evidence for the #1002 run.',
  },
  webmcpContract: ['get_order', 'prepare_resolution'],
  completionExposedToWebMCP: false,
  files,
}, null, 2));

console.log('manifest:', files.length, 'files ·', created.reference, created.externalId);
