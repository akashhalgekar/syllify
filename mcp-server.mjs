#!/usr/bin/env node
/**
 * Syllify MCP server — makes Syllify a tool any MCP-capable LLM can call.
 *
 * No dependencies. Speaks JSON-RPC over stdin/stdout, which is what MCP hosts
 * (Claude Desktop, and anything else that supports MCP) expect.
 *
 * TOOLS IT EXPOSES
 *   parse_syllabus     Deterministic extraction. Returns deadlines, each with the
 *                      line number and the exact line it was read from, plus the
 *                      items it recognised but could not date.
 *   verify_deadlines   The important one. You give it deadlines YOU extracted and
 *                      the syllabus text; it returns only the ones that check out
 *                      against the document, and tells you why it dropped the rest.
 *   read_syllabus_lines  The numbered lines, so a model can cite them.
 *
 * WHY verify_deadlines MATTERS
 *   A model reading a syllabus produces confident, plausible, wrong dates. Running
 *   your own output through this tool turns "I think it's due Oct 14" into
 *   "line 42 of the document says so" — or drops it.
 *
 * INSTALL (Claude Desktop)
 *   Add to claude_desktop_config.json:
 *     {
 *       "mcpServers": {
 *         "syllify": { "command": "node", "args": ["/full/path/to/mcp-server.mjs"] }
 *       }
 *     }
 *   Restart the app. Ask it to parse a syllabus and it will call these tools.
 *
 * INSTALL (anything else)
 *   Run it with stdio transport. Any MCP client works; there is nothing
 *   Claude-specific in here.
 */

import { readFileSync } from "node:fs";
import { prepLines, parse, verifyProposals } from "./parser.mjs";

const NAME = "syllify";
const VERSION = "1.0.0";

const TOOLS = [
  {
    name: "parse_syllabus",
    description:
      "Extract deadlines from syllabus text using deterministic rules. Returns dated deliverables (each with the source line number and the exact line text), items recognised but undated, grading weights, and whether the document even looks like a syllabus. Handles schedule tables, week numbers, session numbers and prose lists. Use this FIRST; it is exact and free.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The full text of the syllabus." },
        path: { type: "string", description: "Alternatively, a path to a .txt file of the syllabus." },
        first_class_date: {
          type: "string",
          description:
            "YYYY-MM-DD. Supply this when the syllabus dates things by session or teaching week instead of calendar dates; without it those items come back undated rather than guessed.",
        },
        date_order: {
          type: "string",
          enum: ["mdy", "dmy"],
          description: "Force how 03/04 is read. Omit to let the document decide.",
        },
      },
    },
  },
  {
    name: "verify_deadlines",
    description:
      "Check deadlines against the syllabus they supposedly came from. Each proposed item must cite a line number that exists and its title's words must appear on that line; a date, if given, must parse and fall inside the term. Returns the items that passed and, for each rejection, the reason. Run your own extractions through this before presenting them as fact.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The syllabus text the items came from." },
        path: { type: "string", description: "Alternatively, a path to a .txt file of the syllabus." },
        items: {
          type: "array",
          description: "The deadlines to check.",
          items: {
            type: "object",
            properties: {
              line: { type: "integer", description: "Zero-based line number from read_syllabus_lines or parse_syllabus." },
              title: { type: "string" },
              type: { type: "string", enum: ["assignment", "reading", "exam"] },
              date: { type: "string", description: "YYYY-MM-DD, or omit when the syllabus states none." },
              time: { type: "string", description: "HH:MM, 24-hour." },
            },
            required: ["line", "title"],
          },
        },
        term_start: { type: "string", description: "YYYY-MM-DD, used for the out-of-term check." },
      },
      required: ["items"],
    },
  },
  {
    name: "read_syllabus_lines",
    description:
      "Return the syllabus as numbered lines after page furniture is removed and wrapped sentences are rejoined. Cite these numbers in verify_deadlines.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        path: { type: "string" },
      },
    },
  },
];

function linesFrom(args) {
  let raw = args.text;
  if (!raw && args.path) raw = readFileSync(args.path, "utf8");
  if (!raw || !String(raw).trim()) throw new Error("Give me either `text` or `path`.");
  return prepLines(String(raw).replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean));
}

function runTool(name, args = {}) {
  if (name === "read_syllabus_lines") {
    const lines = linesFrom(args);
    return { line_count: lines.length, lines: lines.map((l, i) => ({ line: i, text: l })) };
  }

  if (name === "parse_syllabus") {
    const lines = linesFrom(args);
    const doc = parse(lines, {
      name: args.path || "syllabus",
      fid: "mcp",
      termStart: args.first_class_date || undefined,
      dateOrder: args.date_order || undefined,
    });
    return {
      course: doc.code,
      term: doc.term,
      instructor: doc.instructor,
      looks_like_a_syllabus: doc.likely,
      signals_found: doc.signals,
      dates_read_as: doc.dayFirst ? "day/month" : "month/day",
      date_order_was_assumed: doc.orderAssumed,
      needs_first_class_date: doc.needsTermStart,
      numbered_by_session: !!doc.sessionMode,
      lines_read: doc.lines,
      deadlines: doc.items.map((i) => ({
        title: i.t,
        type: i.k === "r" ? "reading" : i.k === "x" ? "exam" : "assignment",
        date: i.d,
        time: i.tm,
        course: i.code,
        source_line_number: i.ln - 1,
        source_line: i.line,
        evidence: i.c >= 0.86 ? "read off the page" : i.c >= 0.65 ? "inferred" : "guessed",
        why: (i.why || []).map((w) => w[0] + " " + w[1]),
      })),
      recognised_but_undated: doc.gaps.map((g) => ({
        source_line_number: g.ln - 1,
        source_line: g.line,
        note: g.note,
      })),
      grading_weights: doc.grading.map(([label, pct]) => ({ label, weight: pct })),
      caveat:
        "Anything the rules did not recognise cannot appear here. Compare against read_syllabus_lines to find what was skipped, then send candidates through verify_deadlines.",
    };
  }

  if (name === "verify_deadlines") {
    const lines = linesFrom(args);
    const { kept, rejected } = verifyProposals(args.items || [], lines, { termStart: args.term_start });
    return {
      verified: kept,
      rejected,
      summary:
        kept.length + " of " + ((args.items || []).length) + " checked out against the document." +
        (rejected.length ? " " + rejected.length + " were dropped; see `rejected` for the reason on each." : ""),
    };
  }

  throw new Error("Unknown tool: " + name);
}

/* ─── JSON-RPC over stdio ─── */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(req) {
  const { id, method, params } = req;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (message, code = -32000) => send({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    return reply({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: NAME, version: VERSION },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return; // no reply
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "ping") return reply({});
  if (method === "tools/call") {
    const toolName = params && params.name;
    try {
      const out = runTool(toolName, (params && params.arguments) || {});
      return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
    } catch (e) {
      return reply({
        content: [{ type: "text", text: "Error: " + (e && e.message ? e.message : String(e)) }],
        isError: true,
      });
    }
  }
  if (id !== undefined) fail("Method not supported: " + method, -32601);
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    if (Array.isArray(req)) req.forEach(handle);
    else handle(req);
  }
});
process.stdin.on("end", () => process.exit(0));
