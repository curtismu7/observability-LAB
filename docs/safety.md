# Safety

- Loopback bind only (`OBS_BIND` is the explicit opt-in the container uses); the compose file publishes `127.0.0.1` only (a test pins it).
- Host header must be a loopback name (or one in `LAB_ALLOWED_HOSTS`); writes must be same-origin.
- Netguard blocks every non-loopback outbound connection (fetch, socket, DNS, UDP) with a self-test, and a test asserts zero attempts. Real mode therefore accepts only a loopback Loki: `OBS_LOKI_URL` must be a plain http(s) URL on `127.0.0.1`, `localhost` or `[::1]`, with no credentials, query or fragment. Anything else is reported as "not configured" with the reason and never contacted.
- Real mode is read-only by construction: one `GET /loki/api/v1/query_range`, `redirect: 'error'`, a 5 s timeout, a 2 MB body cap, at most 1000 lines, no request body, no credentials. The query sent is rebuilt from the parsed LogQL-lite query, never the raw text.
- LogQL-lite is bounded: query 500 characters, 8 matchers, 8 filters, 100-character values; the parser is a single iterative pass. Regex operators (`=~ !~ |~ !~`) accept only a literal alternation, so no regex engine ever sees user text and there is no ReDoS surface. No `eval`, `Function` or `vm`.
- Log lines are rendered as text only (control and bidirectional characters shown as visible escapes). Real-mode lines are untrusted data from your Loki and are treated the same way.
- Incident injection is capped per workspace; workspaces are capped in count and age.
- Everything in mock mode is synthetic: hosts end in `.example`, ids are made up, no real credential, key or token exists anywhere. `customer.config.json` only sets four display strings and is git-ignored.
- No tenant, credential or customer identifier ships.
