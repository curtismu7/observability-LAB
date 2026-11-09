#!/usr/bin/env python3
"""Create (or refresh) the Kibana data view "Demo logs" over demo-logs-*, the indexes the log collector fills from the AI-DEMO2 and lab containers.
Run it yourself in a terminal: the anonymous Kibana user is read-only, so saving a data view needs a user that may write saved objects.

  scripts/kibana-demo-logs-view.py                                          type the password of that user (default elastic; hidden)
  ES_SECRET=<name> ES_SECRET_KEY=<key> scripts/kibana-demo-logs-view.py     read it from a cluster Secret in your own shell
Settings: KIBANA_URL (default http://localhost:5601), KIBANA_USER (default elastic), ES_NS / ES_KUBE_CONTEXT (ping-devops-curtismuir / us).
The password is sent only as a Basic header to KIBANA_URL and is never printed or stored. Running it again overwrites the same data view.
"""
import base64, getpass, json, os, subprocess, sys, urllib.error, urllib.request

KIBANA = os.environ.get("KIBANA_URL", "http://localhost:5601").rstrip("/")
VIEW_ID = "demo-logs"
VIEW = {"attributes": {"title": "demo-logs-*", "name": "Demo logs (AI-DEMO2 and lab containers)", "timeFieldName": "@timestamp"}}


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
    code, res = call("POST", f"/api/saved_objects/index-pattern/{VIEW_ID}?overwrite=true", auth, VIEW)
    if code != 200:
        sys.exit(f"Kibana refused to save the data view (HTTP {code}); nothing was saved: {res.get('error', '')}")
    print("Saved the data view. Look at the logs:")
    print(f"{KIBANA}/app/discover#/?_g=(time:(from:now-24h,to:now))&_a=(dataSource:(dataViewId:'{VIEW_ID}',type:dataView))")


if __name__ == "__main__":
    main()
