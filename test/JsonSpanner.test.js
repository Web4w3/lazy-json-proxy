import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JsonSpanner, skipValue } from '../src/JsonSpanner.js';

describe('JsonSpanner.index — objects', () => {
  test('empty object', () => {
    const { type, spans } = JsonSpanner.index('{}');
    assert.equal(type, 'object');
    assert.equal(spans.size, 0);
  });

  test('single scalar value', () => {
    const json = '{"n":42}';
    const { spans } = JsonSpanner.index(json);
    const { start, end } = spans.get('n');
    assert.equal(json.slice(start, end), '42');
  });

  test('string value', () => {
    const json = '{"s":"hello"}';
    const { spans } = JsonSpanner.index(json);
    const { start, end } = spans.get('s');
    assert.equal(json.slice(start, end), '"hello"');
  });

  test('nested object value', () => {
    const json = '{"o":{"a":1}}';
    const { spans } = JsonSpanner.index(json);
    const raw = json.slice(spans.get('o').start, spans.get('o').end);
    assert.deepEqual(JSON.parse(raw), { a: 1 });
  });

  test('array value', () => {
    const json = '{"arr":[1,2,3]}';
    const { spans } = JsonSpanner.index(json);
    const raw = json.slice(spans.get('arr').start, spans.get('arr').end);
    assert.deepEqual(JSON.parse(raw), [1, 2, 3]);
  });

  test('multiple keys — correct span boundaries', () => {
    const json = '{"a":1,"b":"two","c":true}';
    const { spans } = JsonSpanner.index(json);
    assert.equal(json.slice(spans.get('a').start, spans.get('a').end), '1');
    assert.equal(json.slice(spans.get('b').start, spans.get('b').end), '"two"');
    assert.equal(json.slice(spans.get('c').start, spans.get('c').end), 'true');
  });

  test('key with escaped quote', () => {
    const json = '{"say \\"hi\\"":1}';
    const { spans } = JsonSpanner.index(json);
    assert.ok(spans.has('say "hi"'));
  });

  test('string value with brace inside', () => {
    const json = '{"s":"has { brace }","n":1}';
    const { spans } = JsonSpanner.index(json);
    assert.equal(json.slice(spans.get('s').start, spans.get('s').end), '"has { brace }"');
    assert.equal(json.slice(spans.get('n').start, spans.get('n').end), '1');
  });
});

describe('JsonSpanner.index — arrays', () => {
  test('empty array', () => {
    const { type, spans } = JsonSpanner.index('[]');
    assert.equal(type, 'array');
    assert.equal(spans.size, 0);
  });

  test('array of scalars', () => {
    const json = '[1,"two",true,null]';
    const { spans } = JsonSpanner.index(json);
    assert.equal(json.slice(spans.get(0).start, spans.get(0).end), '1');
    assert.equal(json.slice(spans.get(1).start, spans.get(1).end), '"two"');
    assert.equal(json.slice(spans.get(2).start, spans.get(2).end), 'true');
    assert.equal(json.slice(spans.get(3).start, spans.get(3).end), 'null');
  });

  test('array of objects', () => {
    const json = '[{"id":1},{"id":2}]';
    const { spans } = JsonSpanner.index(json);
    assert.deepEqual(JSON.parse(json.slice(spans.get(0).start, spans.get(0).end)), { id: 1 });
    assert.deepEqual(JSON.parse(json.slice(spans.get(1).start, spans.get(1).end)), { id: 2 });
  });
});

describe('skipValue', () => {
  const cases = [
    ['string',  '"hello"',       7],
    ['number',  '42,',           2],
    ['float',   '3.14}',         4],
    ['true',    'true,',         4],
    ['false',   'false}',        5],
    ['null',    'null }',        4],
    ['object',  '{"a":1}',       7],
    ['array',   '[1,2]',         5],
    ['nested',  '[[1],[2]]',     9],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => assert.equal(skipValue(input, 0), expected));
  }
});

describe('error cases', () => {
  test('throws on non-container root', () => {
    assert.throws(() => JsonSpanner.index('42'), SyntaxError);
  });
  test('throws on unterminated string', () => {
    assert.throws(() => JsonSpanner.index('{"k":"unterminated}'), SyntaxError);
  });
});
