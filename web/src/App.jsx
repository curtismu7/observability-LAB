import { useCallback, useEffect, useRef, useState } from "react";
import LogStream from "./components/LogStream";
import Products from "./components/Products";
import LabelLab from "./components/LabelLab";
import Alerts from "./components/Alerts";
import DiagramTab from "./components/DiagramTab";
import TalkTrack from "./components/TalkTrack";
import ShelfLink from "./components/ShelfLink";
import Searches from "./components/Searches";
import { getJson, resetWorkspace, setMode } from "./api";

export const TABS = [
  { id: "logs", label: "Logs" },
  { id: "searches", label: "Searches", featured: true }, // second and highlighted: it is what most people come for
  { id: "products", label: "Products" },
  { id: "pipeline", label: "Pipeline" },
  { id: "label", label: "Label lab" },
  { id: "alerts", label: "Alerts" },
  { id: "talk", label: "Talk track" },
];
// The banner is never blank: until /api/scenarios answers (or if it fails) it says the safe thing.
export const BANNER_UNKNOWN = "SIMULATED: seeded, synthetic log events and mock alert rules. Nothing here reads a real product log or calls a real tenant.";

const hashParts = () => {
  const h = window.location.hash.replace("#", "");
  const m = /^scenario-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { tab: "logs", scenario: m[1] };
  return { tab: TABS.some((t) => t.id === h) ? h : "logs", scenario: null };
};

export default function App() {
  const [vertical, setVertical] = useState("retail");
  const [story, setStory] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [requested, setRequested] = useState(hashParts().scenario);
  const [presenter, setPresenter] = useState(false);
  const [dataSignal, setDataSignal] = useState(0); // bump = every panel reloads its data
  const [resetMsg, setResetMsg] = useState("");
  const tabsRef = useRef(null);
  const bump = useCallback(() => setDataSignal((n) => n + 1), []);

  const loadInfo = useCallback(() => getJson("/api/info").then(setInfo, () => setInfo(null)), []);
  useEffect(() => { loadInfo(); }, [loadInfo]);
  useEffect(() => { getJson(`/api/scenarios?vertical=${encodeURIComponent(vertical)}`).then((j) => { setStory(j); setError(null); }, (e) => setError(e.message)); }, [vertical]);
  useEffect(() => {
    const on = () => { const p = hashParts(); setTab(p.tab); setRequested(p.scenario); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const select = (id) => { setTab(id); setRequested(null); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };
  const pickScenario = useCallback((sid) => { try { window.history.replaceState(null, "", `#scenario-${sid}`); } catch { /* ignore */ } }, []);

  // Keep the active tab fully in view in the scrolling tab strip (375px).
  useEffect(() => {
    const strip = tabsRef.current; const el = document.getElementById(`tab-${tab}`);
    if (!strip || !el) return;
    const left = el.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 8);
  }, [tab]);

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    bump();
    setResetMsg(ok ? "Reset: your workspace's incidents and relabel switch are back to defaults." : "Reset failed on the server; the view was reloaded.");
  }, [bump]);

  // Rule 19: switch server-side, then reload every panel's data (no page reload, no restart).
  const switchTo = async (source) => {
    if (info?.mode === source) return;
    const res = await setMode(source).catch(() => ({ ok: false, body: {} }));
    if (!res.ok) { setResetMsg(res.body?.detail || "Could not switch mode."); return; }
    await loadInfo();
    bump();
    setResetMsg(`Switched to ${source === "real" ? "Real" : "Mock"}: all data reloaded.`);
  };

  const onKeyTab = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const real = info?.mode === "real";
  const banner = story ? (real ? story.realBanner : story.banner) : BANNER_UNKNOWN;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header>
        <p className="banner" role="note" data-testid="banner">{banner}</p>
        <div className="head">
          <div>
            <h1>Observability Lab</h1>
            {!presenter && story && <p className="intro">{story.intro}</p>}
          </div>
          <div className="head__tools">
            <ShelfLink />
            <span className="chip" data-testid="mode">Mode: {info ? info.mode : "..."}</span>
            {info && (
              <div className="seg" role="group" aria-label="Data source" data-testid="mode-toggle">
                <button type="button" aria-pressed={!real} data-testid="mode-mock" onClick={() => switchTo("mock")}>Mock</button>
                <button type="button" aria-pressed={real} data-testid="mode-real" disabled={!info.realAvailable && !real}
                  title={info.realAvailable ? "Read log lines from your loopback Loki (read-only)" : info.realHint || "Real is not configured. Mock keeps working."}
                  onClick={() => switchTo("real")}>Real</button>
              </div>
            )}
            {!presenter && (
              <label className="inline">Vertical{" "}
                <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
                  {(story ? story.verticals : ["retail"]).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={reset} data-testid="reset">Reset</button>
            <button type="button" aria-pressed={presenter} onClick={() => setPresenter((v) => !v)} data-testid="presenter">{presenter ? "Exit presenter (Esc)" : "Presenter (P)"}</button>
          </div>
        </div>
      </header>
      <main>
        <p className="sr-only" role="status" aria-live="polite" data-testid="status">{resetMsg}</p>
        <div role="tablist" aria-label="Lab sections" className="tabs" ref={tabsRef}>
          {TABS.map((t, i) => (
            <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" className={t.featured ? "tab-featured" : undefined} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)} onKeyDown={(e) => onKeyTab(e, i)}>{t.label}</button>
          ))}
        </div>
        {resetMsg && !presenter && <p className="muted" data-testid="notice">{resetMsg}</p>}
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {error ? <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p> : !story ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {story.talkTrack.filter((t) => ({ logs: ["say-first", "join", "burst"], products: ["say-first", "unverified"], pipeline: ["say-first"], label: ["silence"], alerts: ["burst", "ratio", "real"] }[tab] || ["say-first"]).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "logs" && <LogStream key={vertical} story={story} info={info} dataSignal={dataSignal} requestedId={requested} onSelect={pickScenario} onChanged={bump} />}
              {tab === "products" && <Products story={story} info={info} />}
              {tab === "pipeline" && <DiagramTab vertical={vertical} resetSignal={dataSignal} />}
              {tab === "label" && <LabelLab story={story} info={info} dataSignal={dataSignal} onChanged={bump} />}
              {tab === "alerts" && <Alerts info={info} dataSignal={dataSignal} onChanged={bump} />}
              {tab === "searches" && <Searches info={info} />}
              {tab === "talk" && <TalkTrack talk={story.talkTrack} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
