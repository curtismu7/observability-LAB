import { useEffect, useRef, useState } from "react";
import { visible } from "../safeText";

// Copy to the clipboard: the async API where the page allows it, the old selection trick otherwise. Reports whether it worked.
export async function copyText(text) {
  try {
    // A clipboard call can hang when the tab is not focused, so it gets a deadline before the fallback runs.
    if (navigator.clipboard?.writeText) {
      await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error("clipboard timed out")), 1500))]);
      return true;
    }
  } catch { /* fall through to the selection trick */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function CopyButton({ text, label }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" className="linkish" onClick={click} aria-label={`Copy ${label}`} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed: select the text" : "Copy"}
    </button>
  );
}

// `backticks` in a note mean code.
const withCode = (text) => String(text).split("`").map((part, i) => (i % 2 ? <code key={i}>{visible(part)}</code> : visible(part)));
const external = { target: "_blank", rel: "noopener noreferrer" };

// The Privilege events in Kibana: where to go, and queries to paste. All of it is links and text built by the server from one setting
// (PRIVILEGE_KIBANA_URL); the lab never calls Kibana.
export default function PrivilegeKibana({ kibana }) {
  if (!kibana) return null;
  const saved = kibana.savedSearches || [];
  const queries = kibana.queries || [];
  return (
    <section className="panel" aria-labelledby="kibana-h" data-testid="kibana-panel">
      <h2 id="kibana-h">Privilege logs in Kibana</h2>
      <p className="muted">
        The same Privilege events as the SIEM source, with a dashboard. Kibana needs this tunnel: <code>{kibana.portForward}</code>{" "}
        <CopyButton text={kibana.portForward} label="the port-forward command" />
        {kibana.settingValid === false && <> PRIVILEGE_KIBANA_URL is not usable, so the default origin is shown.</>}
      </p>
      <p>
        <a href={kibana.dashboard} {...external}>Dashboard</a>{" · "}
        <a href={kibana.discover} {...external}>Discover (last 30 days)</a>
      </p>
      {saved.length > 0 && (
        <>
          <h3>Saved searches</h3>
          <ul className="kql-links" data-testid="saved-searches">
            {saved.map((s) => <li key={s.id}><a href={s.url} {...external}>{visible(s.title)}</a> <code>{s.id}</code></li>)}
          </ul>
        </>
      )}
      {queries.length > 0 && (
        <>
          <h3>Ready-made queries (KQL)</h3>
          <div className="scroll">
            <table className="tbl" data-testid="kql-table">
              <caption className="sr-only">KQL queries to copy into Kibana</caption>
              <thead><tr><th>Query</th><th>KQL</th><th>Use</th></tr></thead>
              <tbody>
                {queries.map((qy) => (
                  <tr key={qy.id} data-testid={`kql-${qy.id}`}>
                    <td>{visible(qy.title)}{qy.note && <div className="muted">{visible(qy.note)}</div>}</td>
                    <td><code>{visible(qy.kql)}</code></td>
                    <td><CopyButton text={qy.kql} label={`the query ${qy.title}`} />{" "}<a href={qy.runUrl} aria-label={`Run ${qy.title} in Discover`} {...external}>Run in Discover</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(kibana.fieldNotes || []).length > 0 && <ul className="facts muted">{kibana.fieldNotes.map((n, i) => <li key={i}>{withCode(n)}</li>)}</ul>}
    </section>
  );
}
