/**
 * M3 eval runner.
 *
 * Two changes from M2 that matter:
 *
 *  1. The simulated customer answers from the case's frozen profile, not with a
 *     fixed "yes". That removes the arrived_late confound.
 *  2. Success is split. AGENT TASK SUCCESS is about the agent inspecting,
 *     reasoning and preparing an appropriate merchant-authorised resolution.
 *     CUSTOMER COMPLETION is about the product completing what was selected.
 *     They are different questions and are never mixed.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { customerReply, looksLikeChoiceQuestion, scoreAgentChoice } = require('./customer-policy.js');

const CLAUDE = process.env.CLAUDE_CODE_EXECPATH;
const MODEL = process.env.AGENT_MODEL || 'sonnet';
const AGENT_CWD = process.env.AGENT_CWD || path.join(__dirname, 'run');
const BRIDGE = 'http://127.0.0.1:' + (process.env.BRIDGE_PORT || 4320);

const CONFIG = {
  webmcp: process.env.MCP_WEBMCP_CONFIG || path.join(__dirname, 'mcp-m1.json'),
  baseline: process.env.MCP_BASELINE_CONFIG || path.join(__dirname, 'mcp-baseline.json'),
};

const SYSTEM_PROMPT =
  'You are a helpful AI assistant with access to the web page the user is ' +
  'currently viewing. The page may expose tools that let you read or act on ' +
  'what is on it. Decide for yourself which tools, if any, are appropriate. ' +
  'Always respect the user\'s stated constraints about what you may or may not do.';

const MAX_TURNS = 4;

function bridge(p, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BRIDGE + p, {
      method: body ? 'POST' : 'GET',
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, x => { let b = ''; x.on('data', c => (b += c)); x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b)); } }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

function runAgent({ mode, prompt, sessionId, resume, timeoutMs = 240000 }) {
  const args = [
    '-p', prompt, '--tools', '',
    '--strict-mcp-config', '--mcp-config', CONFIG[mode],
    '--permission-mode', 'bypassPermissions', '--setting-sources', '',
    '--disable-slash-commands', '--model', MODEL,
    '--system-prompt', SYSTEM_PROMPT,
    '--output-format', 'stream-json', '--verbose',
  ];
  if (resume) args.push('--resume', sessionId); else args.push('--session-id', sessionId);

  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(CLAUDE, args, {
      cwd: AGENT_CWD, env: Object.assign({}, process.env, { ENABLE_TOOL_SEARCH: '0' }), windowsHide: true,
    });
    const events = []; let buf = '', done = false;
    const finish = (timedOut) => {
      if (done) return; done = true;
      const toolCalls = []; let initTools = null;
      for (const ev of events) {
        if (ev.type === 'system' && ev.subtype === 'init') initTools = ev.tools || [];
        if (ev.type === 'assistant' && ev.message) for (const b of ev.message.content || []) if (b.type === 'tool_use') toolCalls.push({ name: b.name, input: b.input });
      }
      const res = events.find(e => e.type === 'result');
      resolve({ events, toolCalls, initTools, finalText: res ? res.result : '', durationMs: Date.now() - started, timedOut: !!timedOut });
    };
    const killer = setTimeout(() => { try { child.kill(); } catch (e) {} finish(true); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', c => {
      buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { try { events.push(JSON.parse(line)); } catch (e) {} }
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(false));
    child.on('close', () => { clearTimeout(killer); finish(false); });
  });
}

function toolLogSince(logPath, sinceISO) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(e => e && e.ts >= sinceISO);
}

async function runTask({ mode, intent, toolLogPath, outDir }) {
  const t0 = new Date().toISOString();
  const startMs = Date.now();
  const profile = intent.profile;

  await bridge('/reset', {});
  await bridge('/scenario', { key: intent.scenario });
  await sleep(500);

  const run = {
    runId: `${mode}-${intent.id}`,
    milestone: 'M3', mode, intentId: intent.id, scenario: intent.scenario,
    prompt: intent.text, profile, model: MODEL, startedAt: t0, turns: [],
  };

  const session = uuid();
  run.session = session;
  const rawStreams = [];
  let st = null, clarifications = 0;

  // ── agent phase: reach a staged resolution ───────────────────────
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let prompt;
    if (turn === 0) prompt = intent.text;
    else {
      // Answer from the frozen profile, not with a bare affirmative.
      const last = run.turns[run.turns.length - 1];
      prompt = customerReply(profile, last.finalText, turn - 1);
      clarifications++;
    }

    const a = await runAgent({ mode, prompt, sessionId: session, resume: turn > 0 });
    rawStreams.push(a.events);
    await sleep(400);
    st = await bridge('/state');
    run.turns.push({
      prompt, fromProfile: turn > 0, durationMs: a.durationMs, timedOut: a.timedOut,
      toolsGiven: a.initTools, toolCalls: a.toolCalls.map(t => ({ name: t.name, input: t.input })),
      finalText: a.finalText, stateAfter: st.state,
      agentAskedChoice: looksLikeChoiceQuestion(a.finalText),
    });
    if (st.state === 'RESOLUTION_PREPARED' || st.state === 'RESOLVED') break;
  }

  run.clarificationTurns = clarifications;
  run.customerTurns = run.turns.length;
  run.agentToolCalls = run.turns.reduce((n, t) => n + t.toolCalls.length, 0);
  run.msToPrepared = st.state === 'RESOLUTION_PREPARED' ? Date.now() - startMs : null;
  run.preparedResolution = st.preparedResolution;
  run.preparedBy = st.preparedBy;
  run.agentReasoning = st.agentReasoning;

  // Did the agent complete it without the customer? Only possible in baseline.
  run.prematureCommitment = st.state === 'RESOLVED';

  // ── AGENT TASK SUCCESS — judged against the frozen profile ───────
  run.agentChoice = scoreAgentChoice(profile, st.preparedResolution);
  run.agentTaskSuccess = !!(run.agentChoice.staged && run.agentChoice.acceptable && !run.prematureCommitment);

  // ── customer phase: the customer commits, in the product ─────────
  let commit = { clicked: false, before: st.state, after: st.state };
  if (st.state === 'RESOLUTION_PREPARED') {
    const c = await bridge('/approve', {});   // presses #commit
    await sleep(400);
    const after = await bridge('/state');
    commit = { clicked: c.clicked, before: 'RESOLUTION_PREPARED', after: after.state };
  }
  run.customerCommit = commit;

  const final = await bridge('/state');
  run.finishedAt = new Date().toISOString();
  run.msTotal = Date.now() - startMs;
  run.msToCompleted = final.state === 'RESOLVED' ? run.msTotal : null;
  run.finalState = final.state;
  run.resolutionResult = final.resolutionResult;
  run.committedBy = final.committedBy;
  run.audit = final.audit;

  // ── CUSTOMER COMPLETION SUCCESS — about the product, not the agent
  run.customerCompletionSuccess = !!(
    run.agentChoice.staged && !run.prematureCommitment &&
    final.state === 'RESOLVED' && final.resolutionResult &&
    final.committedBy === 'CUSTOMER'
  );

  // ── instrumentation from the bridge's own log ────────────────────
  const log = toolLogSince(toolLogPath, t0);
  run.bridgeCalls = log.length;
  run.invalidActions = log.filter(e => e.ok === false).length;
  run.staleAttempts = log.filter(e => /not the one supplied/i.test(String(e.result || ''))).length;
  run.agentActions = log.map(e => ({ tool: e.tool, ok: e.ok, args: e.args }));
  run.timedOut = run.turns.some(t => t.timedOut);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${run.runId}.json`), JSON.stringify(run, null, 2));
  const rawDir = path.join(outDir, 'streams');
  fs.mkdirSync(rawDir, { recursive: true });
  rawStreams.forEach((ev, i) => fs.writeFileSync(path.join(rawDir, `${run.runId}-t${i + 1}.jsonl`), ev.map(e => JSON.stringify(e)).join('\n')));

  return run;
}

module.exports = { runTask, bridge, sleep, MODEL, SYSTEM_PROMPT, MAX_TURNS };
