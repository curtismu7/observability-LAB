import { useState } from "react";
import { CopyButton } from "./PrivilegeKibana";
import { visible } from "../safeText";
import {
  PE_ACTOR_TYPES, PE_DEFAULTS, PE_LIMITS, PE_ORDERS, PE_RANGES, PE_SHOW, PE_STATUSES, PE_TYPE_GROUPS, PE_VIA,
  SearchInputError, buildEventsEsql, esqlUrl,
} from "../../../server/src/searches.js";

const external = { target: "_blank", rel: "noopener noreferrer" };
const Pick = ({ id, label, value, onChange, children }) => (
  <p className="field"><label htmlFor={id}>{label}</label>{" "}<select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select></p>
);
const Options = ({ list, any }) => (<>{any && <option value="">{any}</option>}{list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</>);

// Pick values, get the ES|QL: nobody has to know Kibana. Copy it or open it in Discover with the same time range. The lab never calls Kibana.
export default function EventsFilter({ origin }) {
  const [c, setC] = useState(PE_DEFAULTS);
  const set = (k) => (v) => setC((p) => ({ ...p, [k]: v }));
  let esql = null; let problem = null;
  try { esql = buildEventsEsql(c); } catch (e) { if (e instanceof SearchInputError) problem = e.message; else throw e; }
  const rows = c.show === "events";
  return (
    <section className="panel pe-builder" aria-labelledby="pe-builder-h" data-testid="pe-builder">
      <h3 id="pe-builder-h">Build your own search</h3>
      <p className="muted">Choose what to look for; the query writes itself. Anything you leave on "Any" is not filtered.</p>
      <div className="qform">
        <Pick id="pe-type" label="Event type" value={c.type} onChange={set("type")}>
          <option value="">Any event</option>
          {PE_TYPE_GROUPS.map((g) => <optgroup key={g.label} label={g.label}><Options list={g.options} /></optgroup>)}
        </Pick>
        <Pick id="pe-status" label="Result" value={c.status} onChange={set("status")}><Options list={PE_STATUSES} any="Any result" /></Pick>
        <Pick id="pe-actor-type" label="Who" value={c.actorType} onChange={set("actorType")}><Options list={PE_ACTOR_TYPES} any="Anyone" /></Pick>
        <Pick id="pe-via" label="How it arrived" value={c.via} onChange={set("via")}><Options list={PE_VIA} any="Either way" /></Pick>
        <p className="field"><label htmlFor="pe-actor-id">User or application id</label>{" "}
          <input id="pe-actor-id" type="text" value={c.actorId} maxLength={400} placeholder="optional, an exact id" autoComplete="off" spellCheck={false} onChange={(e) => set("actorId")(e.target.value)} /></p>
        <p className="field"><label htmlFor="pe-corr">Follow one sign-in (correlation id)</label>{" "}
          <input id="pe-corr" type="text" value={c.correlationId} maxLength={400} placeholder="optional, an exact id" autoComplete="off" spellCheck={false} onChange={(e) => set("correlationId")(e.target.value)} /></p>
        <Pick id="pe-range" label="When" value={c.range} onChange={set("range")}><Options list={PE_RANGES} /></Pick>
        <Pick id="pe-show" label="Show me" value={c.show} onChange={set("show")}><Options list={PE_SHOW} /></Pick>
        {rows && <Pick id="pe-order" label="Order" value={c.order} onChange={set("order")}><Options list={PE_ORDERS} /></Pick>}
        {rows && <Pick id="pe-limit" label="How many" value={String(c.limit)} onChange={(v) => set("limit")(Number(v))}>{PE_LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}</Pick>}
      </div>
      {problem ? (
        <p className="muted" data-testid="pe-problem">{problem}</p>
      ) : (
        <>
          <p><code data-testid="pe-esql">{visible(esql)}</code></p>
          <p>
            <CopyButton text={esql} label="the query Build your own search" />{" "}
            <a href={esqlUrl(origin, esql, c.range)} aria-label="Run Build your own search in Discover" {...external}>Run in Discover</a>{" "}
            <button type="button" onClick={() => setC(PE_DEFAULTS)}>Clear filters</button>
          </p>
        </>
      )}
    </section>
  );
}
