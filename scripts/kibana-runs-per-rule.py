#!/usr/bin/env python3
"""Add a "Rules: runs, speed and alerts" table to a COPY of Kibana's managed Detection rule monitoring dashboard. Run it yourself in a terminal.

The managed dashboard cannot be edited, and the anonymous Kibana user is read-only, so saving the copy needs a user that may write dashboards.
This script reads the live managed dashboard, adds one table under the five top boxes (one row per rule: runs, average and slowest run time, new
alerts, last run, for the selected time range), and saves the result as a NEW dashboard. The managed one is never changed. Run it again to refresh the copy.

  scripts/kibana-runs-per-rule.py                 type the password of a Kibana user that can save dashboards (default user: elastic; hidden)
  ES_SECRET=<name> ES_SECRET_KEY=<key> scripts/kibana-runs-per-rule.py   read it from a cluster Secret in your own shell
Settings: KIBANA_URL (default http://localhost:5601), KIBANA_USER (default elastic), ES_NS / ES_KUBE_CONTEXT (ping-devops-curtismuir / us).
The password is sent only as a Basic header to KIBANA_URL and is never printed or stored.
"""
import base64, copy, getpass, json, os, subprocess, sys, urllib.error, urllib.request

KIBANA = os.environ.get("KIBANA_URL", "http://localhost:5601").rstrip("/")
SOURCE_ID = "security-detection-rule-monitoring-default"
NEW_ID = "detection-rule-monitoring-runs-per-rule"
DATA_VIEW = "kibana-event-log-data-view"
RUNS_ID = "7e6d1c20-0a4b-4f3e-9d51-5a1b2c3d4e5f"
ROW_H = 9
NOT_CUSTOMIZABLE = "This Kibana-managed dashboard can not be customized. To make a custom version, clone it or edit and save it as a new dashboard."
COPY_NOTE = "This is a copy of the managed dashboard with a table of every rule (runs, speed, alerts, last run) added under the top boxes."
LAYER = "a1b2c3d4-0000-4000-8000-000000000001"
COL = {k: f"a1b2c3d4-0000-4000-8000-00000000001{i}" for i, k in enumerate(["rule", "runs", "avg", "max", "new", "last"])}


def build_copy(source):
    """The managed dashboard object -> {attributes, references} for the copy. Pure: no network."""
    attrs, refs = copy.deepcopy(source["attributes"]), copy.deepcopy(source.get("references", []))
    panels = json.loads(attrs["panelsJSON"])
    # The top boxes are the lens panels in the first row after the full-width header; the new row goes right under them.
    tops = [p for p in panels if p["type"] == "lens"]
    top_y = min(p["gridData"]["y"] for p in tops)
    row_y = max(p["gridData"]["y"] + p["gridData"]["h"] for p in tops if p["gridData"]["y"] == top_y)
    template = next(p for p in tops if p.get("title") == "Rule executions" or p["embeddableConfig"].get("attributes", {}).get("title") == "Rule executions")
    for p in panels:
        if p["gridData"]["y"] >= row_y:
            p["gridData"]["y"] += ROW_H
    new = copy.deepcopy(template)
    new["panelIndex"] = RUNS_ID
    new["gridData"] = {"i": RUNS_ID, "x": 0, "y": row_y, "w": 48, "h": ROW_H}
    new["title"] = "Rules: runs, speed and alerts"
    ec = new["embeddableConfig"]
    ec["description"] = "Every detection rule in the selected time range: how many times it ran, how long runs took, new alerts and when it last ran."
    a = ec["attributes"]
    a["visualizationType"] = "lnsDatatable"
    a["references"] = [{"id": DATA_VIEW, "name": f"indexpattern-datasource-layer-{LAYER}", "type": "index-pattern"}, {"id": DATA_VIEW, "name": "filter-index", "type": "index-pattern"}]
    st = a["state"]
    metric = lambda label, op, field, dtype="number": {"label": label, "dataType": dtype, "operationType": op, "isBucketed": False, "scale": "ratio", "sourceField": field,
                                                        "params": {"emptyAsNull": True}, "customLabel": True}
    run_ms, new_alerts = "kibana.alert.rule.execution.metrics.total_run_duration_ms", "kibana.alert.rule.execution.metrics.alert_counts.new"
    columns = {
        COL["rule"]: {"label": "Rule", "dataType": "string", "operationType": "terms", "scale": "ordinal", "sourceField": "rule.name", "isBucketed": True, "customLabel": True,
                      "params": {"size": 50, "orderBy": {"type": "alphabetical", "fallback": False}, "orderDirection": "asc", "otherBucket": False, "missingBucket": False,
                                 "parentFormat": {"id": "terms"}, "include": [], "exclude": [], "includeIsRegex": False, "excludeIsRegex": False}},
        COL["runs"]: metric("Runs", "count", "___records___"),
        COL["avg"]: metric("Avg run (ms)", "average", run_ms),
        COL["max"]: metric("Slowest run (ms)", "max", run_ms),
        COL["new"]: metric("New alerts", "sum", new_alerts),
        COL["last"]: metric("Last run", "max", "@timestamp", "date"),
    }
    columns[COL["avg"]]["params"]["format"] = {"id": "number", "params": {"decimals": 0}}
    st["visualization"] = {"layerId": LAYER, "layerType": "data", "rowHeight": "single", "headerRowHeight": "single", "density": "compact",
                           "paging": {"size": 10, "enabled": False},
                           "columns": [{"columnId": c, "isTransposed": False, "isMetric": c != COL["rule"]} for c in columns]}
    st["datasourceStates"] = {"formBased": {"layers": {LAYER: {"columns": columns, "columnOrder": list(columns), "incompleteColumns": {}}}}}
    st["internalReferences"], st["adHocDataViews"] = [], {}

    def point_at_data_view(node):  # saved filters name their index; keep them on the one data view the reference list resolves
        if isinstance(node, dict):
            if isinstance(node.get("index"), str):
                node["index"] = DATA_VIEW
            for v in node.values():
                point_at_data_view(v)
        elif isinstance(node, list):
            for v in node:
                point_at_data_view(v)
    point_at_data_view(st.get("filters", []))
    panels.append(new)
    # The header note on the copy said the dashboard cannot be customized; say what this copy is instead.
    for i, p in enumerate(panels):
        panels[i] = json.loads(json.dumps(p).replace(NOT_CUSTOMIZABLE, COPY_NOTE))
    refs += [{"id": DATA_VIEW, "name": f"{RUNS_ID}:indexpattern-datasource-layer-{LAYER}", "type": "index-pattern"}, {"id": DATA_VIEW, "name": f"{RUNS_ID}:filter-index", "type": "index-pattern"}]
    attrs["panelsJSON"] = json.dumps(panels)
    attrs["title"] = "Detection rule monitoring (runs per rule)"
    attrs["description"] = "A copy of the managed Detection rule monitoring dashboard with a table under the top boxes: one row per rule with its runs, run times, new alerts and last run."
    return {"attributes": attrs, "references": refs}


def call(method, path, auth, body=None):
    req = urllib.request.Request(KIBANA + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"kbn-xsrf": "1", "content-type": "application/json", "authorization": auth})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read()[:300].decode("utf8", "replace")}


def password(user):
    secret = os.environ.get("ES_SECRET")
    if not secret:
        return getpass.getpass(f"Password for Kibana user '{user}' (hidden): ")
    key = os.environ.get("ES_SECRET_KEY", "elastic")
    out = subprocess.run(["kubectl", "--context", os.environ.get("ES_KUBE_CONTEXT", "us"), "-n", os.environ.get("ES_NS", "ping-devops-curtismuir"),
                          "get", "secret", secret, "-o", f"jsonpath={{.data.{key}}}"], capture_output=True, text=True)
    return base64.b64decode(out.stdout).decode() if out.returncode == 0 and out.stdout else ""


def main():
    user = os.environ.get("KIBANA_USER", "elastic")
    pw = password(user)
    if not pw:
        sys.exit("no password given")
    auth = "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()
    del pw
    code, src = call("GET", f"/api/saved_objects/dashboard/{SOURCE_ID}", auth)
    if code != 200:
        sys.exit(f"could not read the managed dashboard (HTTP {code}): {src.get('error', '')}")
    code, res = call("POST", f"/api/saved_objects/dashboard/{NEW_ID}?overwrite=true", auth, build_copy(src))
    if code != 200:
        sys.exit(f"Kibana refused to save the copy (HTTP {code}); nothing was saved: {res.get('error', '')}")
    print(f"Saved. Open it: {KIBANA}/app/dashboards#/view/{NEW_ID}?_g=(time:(from:now-15m,to:now))")
    print("Then tell Claude 'dashboard saved'.")


if __name__ == "__main__":
    main()
