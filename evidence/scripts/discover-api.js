/**
 * M0.5 WebMCP API Surface Discovery
 * 
 * Goal: Determine the exact API of document.modelContext
 * before running the full test suite.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '..', 'm0-real');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('WebMCP API Surface Discovery');
  console.log('═══════════════════════════════════════');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: [
      '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
      '--enable-experimental-web-platform-features',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  const consoleLog = [];
  page.on('console', msg => {
    consoleLog.push(msg.text());
    console.log(`  [CONSOLE] ${msg.text()}`);
  });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));

  // Discover the full API surface
  const discovery = await page.evaluate(async () => {
    const mc = document.modelContext;
    if (!mc) return { error: 'no modelContext' };

    const results = {};

    // 1. What is modelContext?
    results.type = typeof mc;
    results.constructor = mc.constructor?.name || 'unknown';

    // 2. All properties and methods
    const ownProps = Object.getOwnPropertyNames(mc);
    const protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(mc));
    const proto2Props = Object.getOwnPropertyNames(Object.getPrototypeOf(Object.getPrototypeOf(mc)));
    results.ownProperties = ownProps;
    results.protoProperties = protoProps;
    results.proto2Properties = proto2Props;

    // 3. What does getTools return?
    try {
      const toolsResult = mc.getTools();
      results.getTools_type = typeof toolsResult;
      results.getTools_constructor = toolsResult?.constructor?.name || 'unknown';
      results.getTools_isArray = Array.isArray(toolsResult);
      results.getTools_isPromise = toolsResult instanceof Promise;
      results.getTools_hasLength = 'length' in (toolsResult || {});
      
      // If it's a Promise, await it
      if (toolsResult instanceof Promise) {
        const resolved = await toolsResult;
        results.getTools_resolved_type = typeof resolved;
        results.getTools_resolved_constructor = resolved?.constructor?.name || 'unknown';
        results.getTools_resolved_isArray = Array.isArray(resolved);
        if (Array.isArray(resolved)) {
          results.getTools_resolved_length = resolved.length;
          if (resolved.length > 0) {
            const t = resolved[0];
            results.firstTool_type = typeof t;
            results.firstTool_constructor = t?.constructor?.name || 'unknown';
            results.firstTool_ownProps = Object.getOwnPropertyNames(t);
            results.firstTool_protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(t));
            results.firstTool_name = t.name;
          }
        }
      } else if (toolsResult && typeof toolsResult[Symbol.iterator] === 'function') {
        // It's iterable
        results.getTools_iterable = true;
        const arr = [...toolsResult];
        results.getTools_spread_length = arr.length;
        if (arr.length > 0) {
          const t = arr[0];
          results.firstTool_type = typeof t;
          results.firstTool_constructor = t?.constructor?.name || 'unknown';
          results.firstTool_ownProps = Object.getOwnPropertyNames(t);
          results.firstTool_protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(t));
          results.firstTool_name = t.name;
        }
      } else {
        // Direct object?
        results.getTools_keys = Object.keys(toolsResult || {});
        if (toolsResult?.length !== undefined) {
          results.getTools_length = toolsResult.length;
          if (toolsResult[0]) {
            const t = toolsResult[0];
            results.firstTool_type = typeof t;
            results.firstTool_constructor = t?.constructor?.name || 'unknown';
            results.firstTool_ownProps = Object.getOwnPropertyNames(t);
            results.firstTool_protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(t));
            results.firstTool_name = t.name;
          }
        }
      }
    } catch (err) {
      results.getTools_error = err.message;
    }

    // 4. What does registerTool return?
    try {
      const testSignal = new AbortController();
      const regResult = mc.registerTool({
        name: '__api_probe',
        description: 'Temporary probe tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => '{}',
      }, { signal: testSignal.signal });

      results.registerTool_type = typeof regResult;
      results.registerTool_constructor = regResult?.constructor?.name || 'unknown';
      results.registerTool_isPromise = regResult instanceof Promise;

      if (regResult instanceof Promise) {
        const resolved = await regResult;
        results.registerTool_resolved_type = typeof resolved;
        results.registerTool_resolved_constructor = resolved?.constructor?.name || 'unknown';
        results.registerTool_resolved_ownProps = resolved ? Object.getOwnPropertyNames(resolved) : [];
        results.registerTool_resolved_protoProps = resolved ? Object.getOwnPropertyNames(Object.getPrototypeOf(resolved)) : [];
        // Is THIS what executeTool needs?
        results.registerTool_resolved = 'object returned';
      } else if (regResult) {
        results.registerTool_ownProps = Object.getOwnPropertyNames(regResult);
        results.registerTool_protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(regResult));
      }

      // Cleanup
      testSignal.abort();
    } catch (err) {
      results.registerTool_error = err.message;
    }

    // 5. executeTool signature
    try {
      results.executeTool_type = typeof mc.executeTool;
      results.executeTool_length = mc.executeTool?.length; // number of expected args
    } catch (err) {
      results.executeTool_error = err.message;
    }

    // 6. addEventListener
    try {
      results.addEventListener_type = typeof mc.addEventListener;
    } catch (err) {}

    return results;
  });

  console.log('\n═══════════════════════════════════════');
  console.log('DISCOVERY RESULTS');
  console.log('═══════════════════════════════════════');
  console.log(JSON.stringify(discovery, null, 2));

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'api-discovery.json'), JSON.stringify(discovery, null, 2));

  await browser.close();
  console.log('\n[DONE] Results saved to api-discovery.json');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
