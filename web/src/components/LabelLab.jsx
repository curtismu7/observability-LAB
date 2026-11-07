import { useCallback, useEffect, useState } from "react";
import { getJson, queryLogs, setRelabel } from "../api";
import { visible } from "../safeText";

const BY_SERVICE = '{service=~"pingone-webhook|pingfederate|ping-gateway"}';
const BY_RAW = '{service=~"/obs-demo-pingone-webhook|/obs-demo-pingfederate|/obs-demo-ping-gateway"}';

export default function LabelLab({ story, info, dataSignal, onChanged }) {
  const [enabled, setEnabled] = useState(null);
  const [byService, setByService] = useState(null);
  const [byRaw, setByRaw] = useState(null);
  const [msg, setMsg] = useState("");
  const real = info?.mode === "real";

  const refresh = useCallback(async () => {
    if (real) return;
    const [r, a, b] = await Promise.all([getJson("/api/relabel"), queryLogs(BY_SERVICE, 500), queryLogs(BY_RAW, 500)]).catch(() => [null, null, null]);
    if (r) setEnabled(r.enabled);
    setByService(a ? `${a.count}${a.truncated ? "+" : ""}` : null); setByRaw(b ? `${b.count}${b.truncated ? "+" : ""}` : null);
  }, [real]);
  useEffect(() => { refresh(); }, [refresh, dataSignal]);

  const toggle = async () => {
    const res = await setRelabel(!enabled);
    if (!res.ok) { setMsg(res.body?.detail || "Could not change the rule."); return; }
    setMsg(res.body.enabled ? "Relabel rule ON: container names become service names." : "Relabel rule OFF: every query by service name now returns nothing, and nothing reports an error.");
    onChanged?.();
  };

  if (real) return <section className="panel" data-testid="label-real"><h2>Label lab</h2><p>This lab changes the mock collector, so it is disabled in Real mode. In Real mode the labels are whatever your collector attached.</p></section>;

  return (
    <div className="gate">
      <section className="panel" aria-labelledby="rule-h">
        <h2 id="rule-h">The collector's relabel rule</h2>
        <p>Docker reports a container as <code>/obs-demo-pingfederate</code>. The collector relabels that to <code>pingfederate</code>. Every dashboard query and alert uses the bare name.</p>
        <pre className="json" tabIndex={0} aria-label="Relabel rule">{visible(story.relabelRule)}</pre>
        <button type="button" aria-pressed={enabled === true} onClick={toggle} disabled={enabled === null} data-testid="relabel-toggle">
          {enabled === false ? "Relabel rule: OFF (press to turn on)" : "Relabel rule: ON (press to turn off)"}
        </button>
        <p className="muted" role="status" data-testid="relabel-msg">{msg}</p>
      </section>
      <section className="panel" aria-labelledby="eff-h">
        <h2 id="eff-h">What your queries see</h2>
        <table className="tbl" data-testid="label-table">
          <thead><tr><th>Query</th><th>Lines</th></tr></thead>
          <tbody>
            <tr><td><code>{BY_SERVICE}</code></td><td data-testid="count-service">{byService ?? "..."}</td></tr>
            <tr><td><code>{BY_RAW}</code></td><td data-testid="count-raw">{byRaw ?? "..."}</td></tr>
          </tbody>
        </table>
        <p className="lesson">{enabled === false ? "The data is all still there, under the raw name. A query by the bare name finds nothing, with no error. Open the Alerts tab: only the silence rule notices." : "While the rule is on the label is the bare name: the first query finds the lines and the second finds none. Turn the rule off and the counts swap, with no error anywhere."}</p>
      </section>
    </div>
  );
}
