import { useState } from "react";
import { CopyButton } from "./PrivilegeKibana";
import { visible } from "../safeText";
import { ESQL_INDEX, ESQL_SEARCHES, SEARCH_GROUPS, SECURITY_ALERTS_PATH, SearchInputError, buildKql, esqlUrl, optionOf, searchRunUrl } from "../../../server/src/searches.js";

const external = { target: "_blank", rel: "noopener noreferrer" };
export const DEFAULT_KIBANA = "http://localhost:5601";

// One search: the question, an optional input that goes into the KQL as one quoted value, Copy and Run in Discover.
function Search({ search, origin }) {
  const first = search.input?.kind === "select" ? optionOf(search.input.options[0]).value : "";
  const [value, setValue] = useState(first);
  let kql = null; let problem = null;
  try { kql = buildKql(search, value); } catch (e) { if (e instanceof SearchInputError) problem = e.message; else throw e; }
  const shown = kql ?? search.kql.replace("{value}", () => `"<${search.input.label.toLowerCase()}>"`);
  const inputId = `in-${search.id}`;
  return (
    <section className="panel search" data-testid={`search-${search.id}`} aria-labelledby={`h-${search.id}`}>
      <h3 id={`h-${search.id}`}>{search.title}</h3>
      <p className="muted">{search.question}</p>
      {search.input && (
        <p className="qform">
          <label htmlFor={inputId}>{search.input.label}</label>{" "}
          {search.input.kind === "select" ? (
            <select id={inputId} value={value} onChange={(e) => setValue(e.target.value)}>
              {search.input.options.map(optionOf).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input id={inputId} type="text" value={value} maxLength={400} placeholder={search.input.placeholder} autoComplete="off" spellCheck={false}
              aria-invalid={problem && value !== "" ? true : undefined} aria-describedby={problem ? `err-${search.id}` : undefined}
              onChange={(e) => setValue(e.target.value)} />
          )}
        </p>
      )}
      <p><code data-testid="kql">{visible(shown)}</code></p>
      <p className="muted">Data view <code>{search.dataView}</code>, last 30 days.</p>
      {problem ? (
        <p className="muted" id={`err-${search.id}`} data-testid="search-problem">{problem}</p>
      ) : (
        <p>
          <CopyButton text={kql} label={`the query ${search.title}`} />{" "}
          <a href={searchRunUrl(origin, search, value)} aria-label={`Run ${search.title} in Discover`} {...external}>Run in Discover</a>
        </p>
      )}
    </section>
  );
}

// One fixed ES|QL query on the pingone-events index: Copy and Run in Discover (ES|QL mode, last 24 hours).
function EsqlSearch({ search, origin }) {
  return (
    <section className="panel search" data-testid={`search-${search.id}`} aria-labelledby={`h-${search.id}`}>
      <h3 id={`h-${search.id}`}>{search.title}</h3>
      <p className="muted">{search.question}</p>
      <p><code data-testid="esql">{visible(search.esql)}</code></p>
      <p className="muted">Index <code>{ESQL_INDEX}</code>, last 24 hours.</p>
      <p>
        <CopyButton text={search.esql} label={`the query ${search.title}`} />{" "}
        <a href={esqlUrl(origin, search.esql)} aria-label={`Run ${search.title} in Discover`} {...external}>Run in Discover</a>
      </p>
    </section>
  );
}

function Links({ kibana, labLinks, origin }) {
  const dashboards = [
    ...(kibana?.dashboard ? [{ id: "privilege-logs-dashboard", title: "Privilege logs dashboard", url: kibana.dashboard }] : []),
    ...(kibana?.links || []).filter((l) => l.url.includes("/app/dashboards")),
  ];
  return (
    <section className="panel" aria-labelledby="links-h" data-testid="search-links">
      <h2 id="links-h">Links</h2>
      <ul className="kql-links">
        <li><a href={kibana?.securityAlerts || `${origin}${SECURITY_ALERTS_PATH}`} {...external}>Security Alerts</a> <span className="muted">Kibana: the alerts the detection rules raised.</span></li>
        {labLinks?.privilegeLogging && <li><a href={labLinks.privilegeLogging.url} {...external}>privilege-logging-LAB: Privilege tab</a> <span className="muted">The local lab that explains each Privilege log.{labLinks.privilegeLogging.settingValid === false && " PRIVILEGE_LOGGING_LAB_URL is not a loopback origin, so the default is shown."}</span></li>}
        {labLinks?.fieldNotes && <li><a href={labLinks.fieldNotes.url} {...external}>field-notes-LAB</a> <span className="muted">The local field notes lab.{labLinks.fieldNotes.settingValid === false && " FIELD_NOTES_URL is not a loopback origin, so the default is shown."}</span></li>}
        {dashboards.map((d) => <li key={d.id}><a href={d.url} {...external}>{visible(d.title)}</a>{d.description && <span className="muted"> {visible(d.description)}</span>}</li>)}
      </ul>
    </section>
  );
}

// Kibana searches that each answer one question. Everything here is text and links built in the browser from the shared catalog and
// the Kibana origin the server reports (PRIVILEGE_KIBANA_URL); nothing calls Kibana.
export default function Searches({ info }) {
  const kibana = info?.siem?.kibana;
  const origin = kibana?.url || DEFAULT_KIBANA;
  return (
    <div className="searches" data-testid="searches">
      <p className="muted">Kibana searches that each answer one question. Type a value where a search asks for one: it goes into the query as one quoted value. Copy the KQL or open it in Discover (last 30 days).</p>
      {info?.mode !== "real" && <p className="chip" data-testid="searches-mock-note">Mock: links point at your Kibana, which holds real events, not this lab's mock stream. The lab never calls Kibana.</p>}
      {kibana?.portForward && <p className="muted">Kibana tunnel: <code>{kibana.portForward}</code></p>}
      {SEARCH_GROUPS.map((g) => (
        <section key={g.id} className="search-group" aria-labelledby={`g-${g.id}`} data-testid={`search-group-${g.id}`}>
          <h2 id={`g-${g.id}`}>{g.title} {g.pending && <span className="tag tag--warn" data-testid="pending">data appears once PingOne forwarding is live</span>}</h2>
          <p className="muted">{g.note}</p>
          <div className="cards">
            {g.searches.map((s) => <Search key={s.id} search={s} origin={origin} />)}
          </div>
        </section>
      ))}
      <section className="search-group" aria-labelledby="g-pingone-events" data-testid="search-group-pingone-events">
        <h2 id="g-pingone-events">PingOne Events lab index (ES|QL)</h2>
        <p className="muted">ES|QL on the index pingone-events-LAB forwards each PingOne event to. Discover opens in ES|QL mode with the query filled in.</p>
        <div className="cards">
          {ESQL_SEARCHES.map((s) => <EsqlSearch key={s.id} search={s} origin={origin} />)}
        </div>
      </section>
      <Links kibana={kibana} labLinks={info?.labLinks} origin={origin} />
    </div>
  );
}
