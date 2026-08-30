/**
 * Shared agent-driving helpers. Identical configuration to run-agent-tests.js:
 * no built-in tools, no other MCP servers, no tool names in any prompt.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const MCP_CONFIG = process.env.MCP_CONFIG || path.join(__dirname, 'mcp.json');
const CLAUDE = process.env.CLAUDE_CODE_EXECPATH;
const AGENT_CWD = process.env.AGENT_CWD || path.join(__dirname, 'run');
const MODEL = process.env.AGENT_MODEL || 'opus';
const BRIDGE = 'http://127.0.0.1:' + (process.env.BRIDGE_PORT || 4310);

const SYSTEM_PROMPT =
  'You are a helpful AI assistant with access to the web page the user is ' +
  'currently viewing. The page may expose tools that let you read or act on ' +
  'what is on it. Decide for yourself which tools, if any, are appropriate. ' +
  'Always respect the user\'s stated constraints about what you may or may not do.';

function bridge(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(BRIDGE + pathname, {
      method: body ? 'POST' : 'GET',
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, res => {
      let b = '';
      res.on('data', c => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b)); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = () => bridge('/state');

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function runAgent(opts) {
  const { prompt, sessionId, resume, label } = opts;
  const args = [
    '-p', prompt,
    '--tools', '',
    '--strict-mcp-config', '--mcp-config', MCP_CONFIG,
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--model', MODEL,
    '--system-prompt', SYSTEM_PROMPT,
    '--output-format', 'stream-json',
    '--verbose',
  ];
  if (resume) args.push('--resume', sessionId);
  else args.push('--session-id', sessionId);

  console.log('\n=== AGENT TURN [' + label + '] ===');
  console.log('PROMPT: ' + JSON.stringify(prompt));

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, {
      cwd: AGENT_CWD,
      env: Object.assign({}, process.env, { ENABLE_TOOL_SEARCH: '0' }),
      windowsHide: true,
    });

    const events = [];
    let buf = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        events.push(ev);
        if (ev.type === 'system' && ev.subtype === 'init') {
          console.log('  [init] tools=' + JSON.stringify(ev.tools || []));
        } else if (ev.type === 'assistant' && ev.message) {
          for (const b of ev.message.content || []) {
            if (b.type === 'text' && b.text.trim()) console.log('  [say] ' + b.text.trim().slice(0, 240));
            if (b.type === 'tool_use') console.log('  [TOOL_USE] ' + b.name + ' ' + JSON.stringify(b.input));
          }
        }
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', code => {
      const toolCalls = [];
      let initTools = null;
      for (const ev of events) {
        if (ev.type === 'system' && ev.subtype === 'init') initTools = ev.tools || [];
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const b of ev.message.content) {
            if (b.type === 'tool_use') toolCalls.push({ name: b.name, input: b.input });
          }
        }
      }
      const result = events.find(e => e.type === 'result');
      resolve({
        label, prompt, sessionId, events, toolCalls, initTools,
        finalText: result ? result.result : '',
        exitCode: code,
      });
    });
  });
}

module.exports = { bridge, sleep, state, uuid, runAgent, MODEL, SYSTEM_PROMPT };
