import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, QueryError, formatQuery, matchesQuery, parseQuery } from '../src/logql.js';

const entry = (labels, message) => ({ labels, message });

test('parses selectors with all four matcher operators and line filters, and formats them canonically', () => {
  const q = parseQuery('  {service=~"a|b",level!="debug", source = "audit.log", x!~"q|r"}  |= "FAIL"  != "hb" |~ "u|v" !~ "w" ');
  assert.equal(q.matchers.length, 4);
  assert.equal(q.filters.length, 4);
  assert.equal(formatQuery(q), '{service=~"a|b", level!="debug", source="audit.log", x!~"q|r"} |= "FAIL" != "hb" |~ "u|v" !~ "w"');
  assert.deepEqual(parseQuery(formatQuery(q)), q, 'round-trips');
});

test('matching: = != =~ !~ on labels and |= != |~ !~ on the line', () => {
  const e = entry({ service: 'pingfederate', level: 'warn' }, 'AUTHN_ATTEMPT FAILURE user=u1');
  const ok = (text) => matchesQuery(parseQuery(text), e);
  assert.equal(ok('{service="pingfederate"}'), true);
  assert.equal(ok('{service="other"}'), false);
  assert.equal(ok('{service!="other"}'), true);
  assert.equal(ok('{service=~"x|pingfederate"}'), true);
  assert.equal(ok('{service=~"pingfed"}'), false, '=~ is an anchored full match, as in Loki');
  assert.equal(ok('{service!~"pingfederate|x"}'), false);
  assert.equal(ok('{service="pingfederate"} |= "FAILURE"'), true);
  assert.equal(ok('{service="pingfederate"} != "FAILURE"'), false);
  assert.equal(ok('{service="pingfederate"} |~ "nope|user=u1"'), true);
  assert.equal(ok('{service="pingfederate"} !~ "nope|user=u1"'), false);
  assert.equal(ok('{missing="x"}'), false, 'a missing label is the empty string');
  assert.equal(ok('{missing!="x"}'), true);
});

test('regex operators accept only a literal alternation: no regex engine ever sees user text (ReDoS)', () => {
  for (const bad of ['(x+)+', '(a|a)*', '.*', 'a{1,99}', '[a-z]+', '^a', 'a$', 'a?', 'a||b', '|a', 'a|', 'a.b', '']) {
    for (const t of [`{a=~"${bad}"}`, `{a="b"} |~ "${bad}"`, `{a!~"${bad}"}`, `{a="b"} !~ "${bad}"`]) {
      assert.throws(() => parseQuery(t), (e) => e instanceof QueryError && e.code === 'regex_unsupported', t);
    }
  }
  // a backslash escape other than \" and \\ never reaches the regex check: refused as a bad query
  assert.throws(() => parseQuery('{a=~"a\\d"}'), (e) => e instanceof QueryError && e.code === 'bad_query');
  // and a long, hostile alternation of the allowed alphabet is still bounded and fast
  const t0 = Date.now();
  const nasty = `{a=~"${'a|'.repeat(40)}a"}`;
  parseQuery(nasty);
  assert.ok(Date.now() - t0 < 200);
});

test('malformed and oversized queries are refused with a stable code, never thrown as a crash', () => {
  const codes = (t) => { try { parseQuery(t); return 'accepted'; } catch (e) { return e instanceof QueryError ? e.code : `CRASH ${e.message}`; } };
  for (const bad of ['', 'x', '{', '{}', '{a}', '{a=b}', '{a="b"', '{a="b",}', '{A-b="x"}', '{a="b"} extra', '{a="b"} |= x', '{a="b"} |=', '{a="b"} |= "x', '{a="b" c="d"}', '{a="\\n"}', 5, null, undefined, {}, ['{a="b"}']]) {
    assert.equal(codes(bad), 'bad_query', JSON.stringify(bad));
  }
  assert.equal(codes(`{a="${'x'.repeat(LIMITS.value + 1)}"}`), 'bad_query');
  assert.equal(codes(`{${Array.from({ length: LIMITS.matchers + 1 }, (_, i) => `l${i}="v"`).join(',')}}`), 'bad_query');
  assert.equal(codes(`{a="b"}${' |= "x"'.repeat(LIMITS.filters + 1)}`), 'bad_query');
  assert.equal(codes(`{a="b"}${' '.repeat(LIMITS.query)}`), 'bad_query');
  assert.equal(codes(`{a="b"} |= "q\\"uote\\\\"`), 'accepted');
});

test('hostile text inside quotes stays data: control characters, markup and unicode round-trip as text', () => {
  const q = parseQuery('{a="<img src=x onerror=alert(1)>"} |= "‮\u0007"');
  assert.equal(q.matchers[0].value, '<img src=x onerror=alert(1)>');
  assert.equal(matchesQuery(q, entry({ a: '<img src=x onerror=alert(1)>' }, 'x‮\u0007y')), true);
});

test('a label named like an Object.prototype key matches nothing: only own labels count', () => {
  const e = entry({ service: 'x' }, 'line');
  assert.equal(matchesQuery(parseQuery('{__proto__="[object Object]"}'), e), false);
  assert.equal(matchesQuery(parseQuery('{constructor="function Object() { [native code] }"}'), e), false);
  assert.equal(matchesQuery(parseQuery('{__proto__!="x"}'), e), true, 'an absent label is the empty string, as in Loki');
  for (const q of ['{toString=""}', '{hasOwnProperty="x"}']) assert.throws(() => parseQuery(q), (err) => err instanceof QueryError, 'uppercase label names are not accepted');
});
