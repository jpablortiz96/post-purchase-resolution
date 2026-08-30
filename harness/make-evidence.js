/**
 * Renders raw agent stream-json transcripts into the markdown session files.
 * Agent text is copied VERBATIM. Nothing is summarised or rewritten.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'evidence', 'm0-agent');

function readStream(file) {
  const p = path.join(OUT, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
}

function renderTurn(title, promptLabel, events) {
  const out = [];
  out.push('## ' + title);
  out.push('');

  const init = events.find(e => e.type === 'system' && e.subtype === 'init');
  if (init) {
    out.push('**Tools presented to the agent** (discovered from the live page, not named in the prompt):');
    out.push('');
    out.push('```');
    out.push(JSON.stringify(init.tools || [], null, 2));
    out.push('```');
    out.push('');
    out.push('**MCP servers:** `' + JSON.stringify(init.mcp_servers || []) + '`');
    out.push('');
  }

  out.push('### Prompt given to the agent (verbatim)');
  out.push('');
  out.push('```text');
  out.push(promptLabel);
  out.push('```');
  out.push('');
  out.push('### Raw transcript');
  out.push('');

  for (const ev of events) {
    if (ev.type === 'assistant' && ev.message) {
      for (const b of ev.message.content || []) {
        if (b.type === 'text' && b.text.trim()) {
          out.push('**AGENT (text):**');
          out.push('');
          out.push('> ' + b.text.trim().split('\n').join('\n> '));
          out.push('');
        }
        if (b.type === 'tool_use') {
          out.push('**AGENT (tool call):** `' + b.name + '`');
          out.push('');
          out.push('```json');
          out.push(JSON.stringify(b.input, null, 2));
          out.push('```');
          out.push('');
        }
      }
    }
    if (ev.type === 'user' && ev.message) {
      for (const b of ev.message.content || []) {
        if (b.type === 'tool_result') {
          const t = Array.isArray(b.content) ? (b.content[0] || {}).text : b.content;
          out.push('**PAGE (tool result via document.modelContext.executeTool):**');
          out.push('');
          out.push('```json');
          out.push(String(t));
          out.push('```');
          out.push('');
        }
      }
    }
  }

  const res = events.find(e => e.type === 'result');
  if (res) {
    out.push('### Agent final message (verbatim, unedited)');
    out.push('');
    out.push('```text');
    out.push(String(res.result));
    out.push('```');
    out.push('');
    out.push('_Model(s) used: `' + Object.keys(res.modelUsage || {}).join(', ') + '` · turns: ' +
             res.num_turns + ' · stop_reason: `' + res.stop_reason + '`_');
    out.push('');
  }
  return out.join('\n');
}

function phase(report, name) {
  return report.phases.find(p => p.phase === name) || {};
}

function main() {
  const report = JSON.parse(fs.readFileSync(path.join(OUT, 'agent-run-report.json'), 'utf8'));

  const header = [
    '# Agent Session 1 — J1 through J5',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Live URL | `' + report.appUrl + '` |',
    '| Agent model | `' + report.model + '` |',
    '| Started | ' + report.startedAt + ' |',
    '| Built-in agent tools | **none** (`--tools ""`) |',
    '| Other MCP servers | **none** (`--strict-mcp-config`) |',
    '| Tool names in prompt | **none** |',
    '',
    '**System prompt given to the agent (verbatim):**',
    '',
    '```text',
    report.systemPrompt,
    '```',
    '',
    'The agent had access to nothing except the tools the live page published',
    'through `document.modelContext`. Every tool call below was executed in the',
    'real page via `document.modelContext.executeTool()`, chosen by the model.',
    '',
    '---',
    '',
  ].join('\n');

  const j1 = phase(report, 'J1');
  const j2 = phase(report, 'J2');
  const j3 = phase(report, 'J3');
  const j4 = phase(report, 'J4');
  const j5 = phase(report, 'J5');

  let s1 = header;
  s1 += renderTurn('J1 — Natural-language discovery', j1.prompt || '', readStream('raw-j1-stream.jsonl'));
  s1 += '\n**Application state after J1:** `' + (j1.stateAfter || {}).state +
        '` — mutation occurred: **' + (j1.noMutation ? 'NO' : 'YES') + '**\n\n---\n\n';

  s1 += renderTurn('J2 — Natural-language preparation', j2.prompt || '', readStream('raw-j2-stream.jsonl'));
  s1 += '\n**Application state after J2:** `' + (j2.stateAfter || {}).state +
        '` · RESOLUTION READY visible: **' + ((j2.stateAfter || {}).resolutionReadyVisible ? 'YES' : 'NO') + '**\n\n---\n\n';

  s1 += [
    '## J3 — Human handoff (15s observation window, no input given)',
    '',
    '| Check | Result |',
    '|---|---|',
    '| State after waiting | `' + (j3.stateAfterWaiting || {}).state + '` |',
    '| Auto-finalized without approval | **' + (j3.didNotAutoFinalize ? 'NO' : 'YES') + '** |',
    '| New agent tool calls during wait | ' + j3.newAgentToolCallsDuringWait + ' |',
    '| `confirm_replacement` was already offered to the agent during its turn | **' +
      (j3.confirmToolWasAvailableToAgentDuringTurn ? 'YES' : 'NO') + '** |',
    '',
    'The last row matters: the agent was holding a tool that would have finalized',
    'the resolution, and did not call it.',
    '',
    '---',
    '',
  ].join('\n');

  s1 += [
    '## J4 — Visible human approval',
    '',
    '| Field | Value |',
    '|---|---|',
    '| State before | `' + (j4.stateBefore || {}).state + '` |',
    '| User action | ' + j4.userAction + ' |',
    '| Control activated | ' + (j4.clicked ? 'yes' : 'no') + ' |',
    '| State after | `' + (j4.stateAfter || {}).state + '` |',
    '| Tools after approval | `' + JSON.stringify(j4.toolsAfterApproval) + '` |',
    '',
    '> The workflow requires a visible approval step before execution becomes valid.',
    '',
    '---',
    '',
  ].join('\n');

  s1 += renderTurn('J5 — Agent resume', j5.prompt || '', readStream('raw-j5-stream.jsonl'));
  s1 += '\n**Application state after J5:** `' + (j5.stateAfter || {}).state +
        '` · replacement id: `' + (j5.replacementId || 'none') + '`\n';

  fs.writeFileSync(path.join(OUT, 'agent-session-1.md'), s1);

  // ---- session 2 (J6) ----
  const j6 = phase(report, 'J6');
  let s2 = [
    '# Agent Session 2 — J6, second run with different wording',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Live URL | `' + report.appUrl + '` |',
    '| Agent model | `' + report.model + '` |',
    '| Fresh session | yes (no memory of run 1) |',
    '| Tool names in prompt | **none** |',
    '',
    'Initial state: `' + (j6.initialState || {}).state + '` · tools: `' +
      JSON.stringify((j6.initialState || {}).activeToolChips) + '`',
    '',
    '---',
    '',
  ].join('\n');

  s2 += renderTurn('J6a — Preparation from differently-worded intent', j6.preparePrompt || '',
                   readStream('raw-j6a-stream.jsonl'));
  s2 += '\n**State after preparation:** `' + (j6.stateAfterPrepare || {}).state + '`\n\n---\n\n';

  s2 += [
    '## J6 — Human approval (run 2)',
    '',
    '| Field | Value |',
    '|---|---|',
    '| State before | `' + (j6.humanApproval || {}).before + '` |',
    '| User action | HUMAN clicked the Approve control in the page UI |',
    '| State after | `' + (j6.humanApproval || {}).after + '` |',
    '',
    '---',
    '',
  ].join('\n');

  s2 += renderTurn('J6b — Agent resume (run 2)', 'Continue.', readStream('raw-j6b-stream.jsonl'));
  s2 += '\n**Final state:** `' + (j6.finalState || {}).state + '` · replacement id: `' +
        ((j6.finalState || {}).replacementId || 'none') + '`\n';

  fs.writeFileSync(path.join(OUT, 'agent-session-2.md'), s2);

  console.log('wrote agent-session-1.md and agent-session-2.md');
}

main();
