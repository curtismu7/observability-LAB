// LogQL-lite: the small, safe subset of Loki's query language this lab speaks.
//   {service="pingfederate", level!="debug"} |= "FAILURE" != "heartbeat"
// Label matchers: =  !=  =~  !~     Line filters: |=  !=  |~  !~
// Regex operators accept ONLY a literal alternation ("a|b|c"): no regex engine ever sees user text, so there is no ReDoS
// surface (rule: hostile input is bounded). The same parsed query is what Real mode sends to Loki, rebuilt from the
// parsed parts, never the raw text. Single pass, iterative, bounded.
export const LIMITS = { query: 500, matchers: 8, filters: 8, value: 100 };

const LABEL = /^[a-z_][a-z0-9_]{0,31}$/;
const ALTERNATION = /^[A-Za-z0-9_ :/=-]+(\|[A-Za-z0-9_ :/=-]+)*$/;
const MATCH_OPS = ['=~', '!~', '!=', '='];
const FILTER_OPS = ['|=', '|~', '!=', '!~'];

export class QueryError extends Error {
  constructor(code, detail) { super(detail); this.code = code; this.detail = detail; }
}

function readString(s, i) {
  if (s[i] !== '"') throw new QueryError('bad_query', `expected a double-quoted string at position ${i + 1}`);
  let out = '';
  let j = i + 1;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '"') { j++; return [out, j]; }
    if (c === '\\') {
      const n = s[j + 1];
      if (n !== '"' && n !== '\\') throw new QueryError('bad_query', 'only \\" and \\\\ escapes are supported');
      out += n; j++;
    } else out += c;
    if (out.length > LIMITS.value) throw new QueryError('bad_query', `a quoted value is longer than ${LIMITS.value} characters`);
  }
  throw new QueryError('bad_query', 'unterminated string');
}

const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

function checkAlternation(op, value) {
  if (!ALTERNATION.test(value)) throw new QueryError('regex_unsupported', `${op} accepts only a literal alternation such as "a|b|c" (letters, digits, space and _ : / = -)`);
}

export function parseQuery(text) {
  if (typeof text !== 'string') throw new QueryError('bad_query', 'query must be text');
  if (text.length > LIMITS.query) throw new QueryError('bad_query', `query is longer than ${LIMITS.query} characters`);
  const s = text;
  let i = skipWs(s, 0);
  if (s[i] !== '{') throw new QueryError('bad_query', 'a query starts with a label selector like {service="pingfederate"}');
  i++;
  const matchers = [];
  for (;;) {
    i = skipWs(s, i);
    if (s[i] === '}') { i++; break; }
    if (matchers.length) {
      if (s[i] !== ',') throw new QueryError('bad_query', `expected "," or "}" at position ${i + 1}`);
      i = skipWs(s, i + 1);
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i, i + 40));
    if (!m || !LABEL.test(m[0])) throw new QueryError('bad_query', `expected a label name at position ${i + 1}`);
    i += m[0].length; i = skipWs(s, i);
    const op = MATCH_OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new QueryError('bad_query', `expected one of = != =~ !~ at position ${i + 1}`);
    i = skipWs(s, i + op.length);
    let value; [value, i] = readString(s, i);
    if (op === '=~' || op === '!~') checkAlternation(op, value);
    if (matchers.length >= LIMITS.matchers) throw new QueryError('bad_query', `at most ${LIMITS.matchers} label matchers`);
    matchers.push({ label: m[0], op, value });
  }
  if (!matchers.length) throw new QueryError('bad_query', 'the selector needs at least one matcher');
  const filters = [];
  for (;;) {
    i = skipWs(s, i);
    if (i >= s.length) break;
    const op = FILTER_OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new QueryError('bad_query', `expected a line filter (|= != |~ !~) at position ${i + 1}`);
    i = skipWs(s, i + op.length);
    let value; [value, i] = readString(s, i);
    if (op === '|~' || op === '!~') checkAlternation(op, value);
    if (filters.length >= LIMITS.filters) throw new QueryError('bad_query', `at most ${LIMITS.filters} line filters`);
    filters.push({ op, value });
  }
  return { matchers, filters };
}

const esc = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
// The canonical text of a parsed query: what Real mode sends to Loki.
export function formatQuery({ matchers, filters }) {
  return `{${matchers.map((m) => `${m.label}${m.op}"${esc(m.value)}"`).join(', ')}}${filters.map((f) => ` ${f.op} "${esc(f.value)}"`).join('')}`;
}

const alt = (value) => new Set(value.split('|'));
function labelMatches({ op, value, label }, labels) {
  const a = Object.hasOwn(labels, label) ? String(labels[label]) : ''; // own keys only: {__proto__=...} must not match
  if (op === '=') return a === value;
  if (op === '!=') return a !== value;
  const inSet = alt(value).has(a); // =~ and !~ are anchored full-match alternations, as in Loki
  return op === '=~' ? inSet : !inSet;
}
function lineMatches({ op, value }, line) {
  if (op === '|=') return line.includes(value);
  if (op === '!=') return !line.includes(value);
  const any = [...alt(value)].some((v) => line.includes(v));
  return op === '|~' ? any : !any;
}

// entry: { labels: {...}, message }
export const matchesQuery = (q, entry) => q.matchers.every((m) => labelMatches(m, entry.labels)) && q.filters.every((f) => lineMatches(f, entry.message));
