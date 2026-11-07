import { useCallback, useEffect, useState } from "react";
import { getJson, simulate } from "../api";
import { visible } from "../safeText";

export default function Alerts({ info, dataSignal, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState("");
  const real = info?.mode === "real";

  const load = useCallback(() => getJson("/api/alerts").then((j) => { setData(j); setError(null); }, (e) => { setData(null); setError(e.message); }), []);
  useEffect(() => { load(); }, [load, dataSignal]);

  const go = async (name, label) => {
    const res = await simulate(name);
    if (!res.ok) { setMsg(res.body?.detail || "That needs Mock mode."); return; }
    setMsg(`${label} injected into the mock stream.`);
    onChanged?.();
  };

  return (
    <div className="alerts">
      <section className="panel" aria-labelledby="sim-h">
        <h2 id="sim-h">Make something go wrong</h2>
        <div className="seg">
          <button type="button" disabled={real} title={real ? "Changes the mock stream. Switch to Mock." : "Eight failed sign-ins in two minutes"} onClick={() => go("login-burst", "A burst of failed sign-ins")} data-testid="sim-burst">Simulate sign-in burst</button>
          <button type="button" disabled={real} title={real ? "Changes the mock stream. Switch to Mock." : "Fourteen 5xx responses in two minutes"} onClick={() => go("gateway-5xx", "A gateway failure")} data-testid="sim-gateway">Simulate gateway failure</button>
          <button type="button" onClick={load}>Re-evaluate</button>
        </div>
        <p className="muted" role="status">{msg}</p>
      </section>
      {error && <p className="field-error" role="alert">{visible(error)}</p>}
      <div className="cards" data-testid="alert-list">
        {(data?.rules || []).map((r) => (
          <section key={r.id} className="panel" aria-labelledby={`a-${r.id}`} data-testid={`alert-${r.id}`} data-state={r.state}>
            <h2 id={`a-${r.id}`}>{r.title} <span className={r.state === "firing" ? "tag tag--deny" : "tag tag--ok"}>{r.state === "firing" ? "FIRING" : "ok"}</span></h2>
            <p>{visible(r.summary)}</p>
            <p className="muted">{r.lesson}</p>
            <details><summary>Query and evidence</summary>
              <pre className="json" tabIndex={0} aria-label={`Query of ${r.title}`}>{visible(r.query)}</pre>
              <pre className="json" tabIndex={0} aria-label={`Evidence of ${r.title}`}>{visible(JSON.stringify(r.evidence, null, 2))}</pre>
            </details>
          </section>
        ))}
      </div>
      <p className="muted">There is no external receiver: nothing pages, emails or posts anywhere. Rules run over the {real ? "REAL Loki" : "mock store"}.</p>
    </div>
  );
}
