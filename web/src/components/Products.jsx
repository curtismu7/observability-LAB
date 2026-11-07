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

export default function Products({ story }) {
  return (
    <div className="products">
      <p className="muted">Each product logs differently. Line shapes are illustrative unless a source is named; the status tag says which.</p>
      <div className="cards">
        {story.products.map((p) => (
          <section key={p.id} className="panel" aria-labelledby={`p-${p.id}`} data-testid={`product-${p.id}`}>
            <h2 id={`p-${p.id}`}>{p.name}</h2>
            <p>{p.how}</p>
            <dl className="kv">
              <dt>Service label</dt><dd><code>{p.service}</code></dd>
              <dt>Container name</dt><dd><code>{p.container}</code></dd>
            </dl>
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
