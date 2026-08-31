/**
 * MCP client configs must carry absolute paths, because the agent process is
 * spawned with a different working directory. Committing them would bake in one
 * machine's layout and break a clean clone, so they are generated here from
 * __dirname and written to harness/run/ (which is gitignored).
 *
 * Require this module before spawning an agent; it writes the files and returns
 * their paths.
 */

const fs = require('fs');
const path = require('path');

const RUN = path.join(__dirname, 'run');
fs.mkdirSync(RUN, { recursive: true });

const abs = f => path.join(__dirname, f).split(path.sep).join('/');

function write(name, config) {
  const p = path.join(RUN, name);
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
  return p;
}

function webmcp(bridgePort, logName) {
  const env = { BRIDGE_PORT: String(bridgePort) };
  if (logName) env.MCP_LOG = path.join(RUN, logName).split(path.sep).join('/');
  return { mcpServers: { webmcp: { command: 'node', args: [abs('mcp-webmcp.js')], env } } };
}

function browser(bridgePort) {
  return { mcpServers: { browser: { command: 'node', args: [abs('mcp-browser.js')], env: { BRIDGE_PORT: String(bridgePort) } } } };
}

function combined(bridgePort) {
  return {
    mcpServers: {
      webmcp: { command: 'node', args: [abs('mcp-webmcp.js')], env: { BRIDGE_PORT: String(bridgePort) } },
      browser: { command: 'node', args: [abs('mcp-browser.js')], env: { BRIDGE_PORT: String(bridgePort) } },
    },
  };
}

/** Generate every config the harness needs. Ports match the documented layout. */
function generate({ webmcpPort = 4320, baselinePort = 4321, combinedPort = 4330 } = {}) {
  return {
    webmcp: write('mcp-webmcp.json', webmcp(webmcpPort, 'mcp-trace.jsonl')),
    baseline: write('mcp-baseline.json', browser(baselinePort)),
    combined: write('mcp-combined.json', combined(combinedPort)),
  };
}

module.exports = { generate, write, RUN };
