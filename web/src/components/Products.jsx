import PrivilegeKibana from "./PrivilegeKibana";
import { visible } from "../safeText";

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag", UNVERIFIED: "tag tag--warn" };

export function Facts({ facts }) {
  return (
    <section className="panel" aria-labelledby="facts-h" data-testid="facts">
      <h2 id="facts-h">What is measured and what is not</h2>
      <ul className="facts">
        {facts.map((f) => <li key={f.id}><span className={STATUS_CLASS[f.status] || "tag"}>{f.status}</span> {f.text}</li>)}
      </ul>
    </section>
  );
}

// The Privilege products share one Kibana data view for the SIEM events. The link is an anchor to the origin the owner set (default the
// usual port-forward); the lab never calls it.
const PRIVILEGE_PRODUCTS = new Set(["privilege", "pgateway", "phosted", "pevents", "pguard", "psiem"]);

function KibanaLink({ siem }) {
  if (!siem?.kibana) return null;
  return (
    <p className="kibana" data-testid="kibana-link">
      <a href={siem.kibana.deepLink} target="_blank" rel="noopener noreferrer">Open in Kibana (Privilege logs)</a>{" "}
      <span className="muted">Needs the tunnel: <code>{siem.kibana.portForward}</code></span>
      {!siem.kibana.settingValid && <span className="muted"> PRIVILEGE_KIBANA_URL is not usable, so the default is shown.</span>}
    </p>
  );
}

function SiemSetup({ siem }) {
  if (!siem) return null;
  return (
    <p className="muted" data-testid="siem-setup">
      {siem.configured
        ? <>Real reads <code>{siem.index}</code> read-only. Ask for <code>{`{service="${siem.service}"}`}</code>.</>
        : <>Real is not set up for this source: {visible(siem.problem)} Mock shows the recorded sample.</>}
    </p>
  );
}

export default function Products({ story, info }) {
  return (
    <div className="products">
      <p className="muted">Each product logs differently. Line shapes are illustrative unless a source is named; the status tag says which.</p>
      <PrivilegeKibana kibana={info?.siem?.kibana} />
      <div className="cards">
        {story.products.map((p) => (
          <section key={p.id} className="panel" aria-labelledby={`p-${p.id}`} data-testid={`product-${p.id}`}>
            <h2 id={`p-${p.id}`}>{p.name}</h2>
            <p>{p.how}</p>
            <dl className="kv">
              <dt>Service label</dt><dd><code>{p.service}</code></dd>
              <dt>Container name</dt><dd><code>{p.container}</code></dd>
            </dl>
            {PRIVILEGE_PRODUCTS.has(p.id) && <KibanaLink siem={info?.siem} />}
            {p.id === "psiem" && <SiemSetup siem={info?.siem} />}
            {p.sources.map((s) => (
              <div key={s.id} className="source">
                <h3>{s.title} <span className={STATUS_CLASS[s.status] || "tag"}>{s.status}</span></h3>
                <p className="muted">{s.where}</p>
                <pre className="json" tabIndex={0} aria-label={`Sample ${s.title}`}>{visible(s.sample)}</pre>
                <p className="muted">{s.note}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
      <Facts facts={story.facts} />
    </div>
  );
}
