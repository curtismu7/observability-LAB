import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hops from "./Hops";
import LineDetail from "./LineDetail";
import { queryLogs, setRelabel, simulate } from "../api";
import { visible } from "../safeText";

export const DEFAULT_QUERY = '{service=~"pingone-webhook|pingfederate|ping-gateway"}';
const PRODUCT_NAMES = { pingone: "PingOne", pingfederate: "PingFederate", pinggateway: "Ping Gateway", phosted: "Privilege hosted gateway", pevents: "Privilege gateway events", pguard: "Prompt-Guard sidecar", mcpbank: "Banking MCP server", llmproxy: "LLM proxy", authz: "Authz server", psiem: "Privilege SIEM", mcpweather: "Weather MCP server", unknown: "Other" };
const LEVEL_CLASS = { error: "tag tag--deny", fatal: "tag tag--deny", warn: "tag tag--warn", warning: "tag tag--warn", info: "tag", debug: "tag tag--quiet" };
const clock = (iso) => iso.slice(11, 19);
// The SIEM's events are sparse (admin changes), so its queries can look back days; Loki and the mock keep their 30 minutes.
const SIEM_SERVICE = "privilege-siem";
const WINDOWS = [{ minutes: 30, label: "30 minutes" }, { minutes: 1440, label: "24 hours" }, { minutes: 10080, label: "7 days" }, { minutes: 43200, label: "30 days" }];
const askingSiem = (q) => q.includes(SIEM_SERVICE);

// Runs a scenario's action (mock only), then returns the query to run.
async function runAction(action) {
  if (!action) return { ok: true };
  if (action.kind === "incident") return simulate(action.name);
  if (action.kind === "relabel") return setRelabel(action.enabled);
  return { ok: true };
}

export default function LogStream({ story, info, dataSignal, requestedId, onSelect, onChanged }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [draft, setDraft] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState("all");
  const [level, setLevel] = useState("all");
  const [scenario, setScenario] = useState(null);
  const [windowMin, setWindowMin] = useState(30);
  const seq = useRef(0);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Clicking to select text in a line must not collapse it.
  const clicked = (id) => { if (window.getSelection?.()?.toString()) return; toggle(id); };
  const real = info?.mode === "real";

  const load = useCallback(async (q) => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await queryLogs(q, 200, real && askingSiem(q) ? windowMin : undefined);
      if (mine === seq.current) { setResult(r); setError(null); }
    } catch (e) {
      if (mine === seq.current) { setError(e.message); setResult(null); }
    } finally { if (mine === seq.current) setBusy(false); }
  }, [real, windowMin]);

  useEffect(() => { load(query); }, [query, dataSignal, load]);

  const submit = (e) => { e?.preventDefault(); if (draft === query) load(query); else setQuery(draft); };

  const pick = useCallback(async (sc) => {
    setScenario(sc);
    onSelect?.(sc.id);
    const res = await runAction(sc.action);
    if (!res.ok) { setError(res.body?.detail || "That step needs Mock mode."); return; }
    if (sc.action) onChanged?.();
    setDraft(sc.query); setProduct("all"); setLevel("all");
    if (sc.query === query) load(sc.query); else setQuery(sc.query);
  }, [load, onChanged, onSelect, query]);

  useEffect(() => {
    if (!requestedId || !story) return;
    const sc = story.scenarios.find((s) => s.id === requestedId);
    if (sc && !(real && sc.action)) pick(sc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedId, story]);

  const shown = useMemo(() => (result?.entries || []).filter((e) => (product === "all" || e.product === product) && (level === "all" || e.level === level)), [result, product, level]);
  const products = useMemo(() => [...new Set((result?.entries || []).map((e) => e.product))], [result]);
  const levels = useMemo(() => [...new Set((result?.entries || []).map((e) => e.level))], [result]);

  return (
    <div className="logs">
      <section className="panel" aria-labelledby="scen-h">
        <h2 id="scen-h">Try a scenario</h2>
        <div className="seg" role="group" aria-label="Scenarios">
          {story.scenarios.map((sc) => {
            const blocked = real && !!sc.action;
            return (
              <button key={sc.id} type="button" aria-pressed={scenario?.id === sc.id} disabled={blocked} data-testid={`scenario-${sc.id}`}
                title={blocked ? "This step changes the mock stream. Switch to Mock to run it." : sc.title} onClick={() => pick(sc)}>{sc.title}</button>
            );
          })}
        </div>
        {scenario && <p className="lesson" data-testid="lesson"><strong>{scenario.title}.</strong> {scenario.lesson}</p>}
      </section>

      <section className="panel" aria-labelledby="q-h">
        <h2 id="q-h">Query</h2>
        <form onSubmit={submit} className="qform">
          <label htmlFor="q" className="sr-only">LogQL-lite query</label>
          <input id="q" className="qinput" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} autoComplete="off" maxLength={500} data-testid="query" />
          <button type="submit" data-testid="run">{busy ? "Running..." : "Run"}</button>
        </form>
        {real && askingSiem(query) && (
          <p className="muted">
            <label>Look back{" "}
              <select value={windowMin} onChange={(e) => setWindowMin(Number(e.target.value))} data-testid="siem-window">
                {WINDOWS.map((w) => <option key={w.minutes} value={w.minutes}>{w.label}</option>)}
              </select>
            </label>{" "}
            The Privilege SIEM holds sparse events, so it can look back up to 30 days.
          </p>
        )}
        <p className="muted">Label matchers: <code>=</code> <code>!=</code> <code>=~</code> <code>!~</code>. Line filters: <code>|=</code> <code>!=</code> <code>|~</code> <code>!~</code>. Regex operators take only a literal list like <code>"a|b"</code>.</p>
        {error && <p className="field-error" role="alert" data-testid="query-error">{visible(error)}</p>}
        {result && (
          <>
            <p className="muted" data-testid="count" role="status">{result.count} line(s){result.truncated ? " (more exist; showing the newest)" : ""} from the {result.source === "real" ? (askingSiem(query) ? "REAL Privilege SIEM (Elasticsearch)" : "REAL Loki") : "MOCK store"}{result.source === "mock" && !result.relabel ? "; the relabel rule is OFF" : ""}.</p>
            <div className="seg" role="group" aria-label="Filter shown lines by product">
              <button type="button" aria-pressed={product === "all"} onClick={() => setProduct("all")}>All products</button>
              {products.map((p) => <button key={p} type="button" aria-pressed={product === p} onClick={() => setProduct(p)}>{PRODUCT_NAMES[p] || p}</button>)}
            </div>
            <div className="seg" role="group" aria-label="Filter shown lines by level">
              <button type="button" aria-pressed={level === "all"} onClick={() => setLevel("all")}>All levels</button>
              {levels.map((l) => <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>{l}</button>)}
            </div>
            <div className="scroll">
              <table className="tbl logtable" data-testid="log-table">
                <caption className="sr-only">Log lines, newest first</caption>
                <thead><tr><th>Time (UTC)</th><th>Product</th><th>Service</th><th>Level</th><th>Line</th></tr></thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={5} className="muted" data-testid="empty">No lines. {result.count === 0 && result.source === "mock" && !result.relabel ? "The lines still exist under the raw container name; nothing reported an error." : "Try a wider query."}</td></tr>}
                  {shown.map((e) => {
                    const isOpen = open.has(e.id);
                    const traceSearch = () => { const q = `{service=~"pingone-webhook|pingfederate|ping-gateway"} |= "${e.traceId}"`; setDraft(q); setQuery(q); };
                    return (
                      <Fragment key={e.id}>
                        <tr className="logrow" tabIndex={0} aria-expanded={isOpen} data-testid="log-row" title={isOpen ? "Click to hide the details" : "Click for details"}
                          onClick={() => clicked(e.id)}
                          onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); toggle(e.id); } }}>
                          <td><code>{clock(e.ts)}</code></td>
                          <td>{PRODUCT_NAMES[e.product] || e.product}</td>
                          <td><code>{visible(e.service)}</code></td>
                          <td><span className={LEVEL_CLASS[e.level] || "tag"}>{visible(e.level)}</span></td>
                          <td className="logline"><code>{visible(e.message)}</code>{e.traceId && <button type="button" className="linkish" title="Search this trace id" onClick={(ev) => { ev.stopPropagation(); traceSearch(); }}>trace</button>}</td>
                        </tr>
                        {isOpen && <tr className="logdetail"><td colSpan={5}><LineDetail entry={e} story={story} onTrace={traceSearch} /></td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Hops hops={result.hops} traceId={result.traceId} />
          </>
        )}
      </section>
    </div>
  );
}
