import { useMemo } from "react";
import Json from "./Json";
import { visible } from "../safeText";

const PAIR = /([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|[^\s"]+)/g;
const MAX_PAIRS = 40;
const MAX_VALUE = 400;

// The structure inside a log line, if it has any: a JSON object, or key=value pairs (logfmt). Plain text has none.
// Never throws, never runs a user-supplied pattern: the one regex above is fixed and the input is already capped upstream.
export function parseFields(message) {
  const text = String(message ?? "").trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object") return { kind: "json", value };
    } catch { /* not JSON: fall through to key=value */ }
  }
  const pairs = [];
  for (const m of text.matchAll(PAIR)) {
    let v = m[2];
    if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    pairs.push([m[1], String(v)]);
    if (pairs.length >= MAX_PAIRS) break;
  }
  return pairs.length >= 2 ? { kind: "pairs", pairs } : null;
}

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag tag--warn", UNVERIFIED: "tag tag--warn" };

// What a clicked log line adds beyond the table row: the exact time, the labels, the whole message, its parts, and what kind of
// line it is (from the lab's own source notes, with the honesty label). All of it is text, never markup.
export default function LineDetail({ entry, story, onTrace }) {
  const product = story?.products?.find((p) => p.service === entry.service);
  const source = product?.sources?.find((s) => s.id === entry.source);
  const parsed = useMemo(() => parseFields(entry.message), [entry.message]);
  const labels = entry.labels && Object.keys(entry.labels).length
    ? Object.entries(entry.labels)
    : [["service", entry.service], ["source", entry.source], ["level", entry.level]];
  return (
    <dl className="linedetail" data-testid="line-detail">
      <dt>Time</dt>
      <dd><code>{entry.ts}</code></dd>
      <dt>Labels</dt>
      <dd>{labels.map(([k, v]) => <span key={k} className="tag tag--quiet">{visible(k)}={visible(String(v)).slice(0, 120)}</span>)}</dd>
      <dt>Message</dt>
      <dd><pre className="json" tabIndex={0} aria-label="Whole log line">{visible(entry.message)}</pre></dd>
      {parsed?.kind === "pairs" && (
        <>
          <dt>Fields</dt>
          <dd>
            <table className="tbl fieldtbl">
              <caption className="sr-only">Fields found in the line</caption>
              <tbody>{parsed.pairs.map(([k, v], i) => <tr key={i}><td><code>{visible(k)}</code></td><td><code>{visible(v).slice(0, MAX_VALUE)}</code></td></tr>)}</tbody>
            </table>
          </dd>
        </>
      )}
      {parsed?.kind === "json" && (<><dt>Fields</dt><dd><Json value={parsed.value} label="Fields parsed from the line" /></dd></>)}
      {source && (
        <>
          <dt>What this line is</dt>
          <dd>
            <strong>{visible(source.title)}</strong>{" "}
            <span className={STATUS_CLASS[source.status] || "tag"}>{visible(source.status)}</span>
            <div>{visible(source.where)}</div>
            {source.note && <p className="muted">{visible(source.note)}</p>}
          </dd>
        </>
      )}
      {entry.traceId && (
        <>
          <dt>Trace</dt>
          <dd><code>{entry.traceId}</code><button type="button" className="linkish" onClick={onTrace}>search this trace</button></dd>
        </>
      )}
    </dl>
  );
}
