const { test } = require('node:test');
const assert = require('node:assert');
const tf = require('../../src/macos/core/timefmt');

test('parseWorkSeconds: valid hh:mm (note: hh:mm, so 25 min is 00:25)', () => {
  assert.equal(tf.parseWorkSeconds('00:25'), 25 * 60);      // 25-minute pomodoro default
  assert.equal(tf.parseWorkSeconds('25:00'), 25 * 3600);    // 25 hours
  assert.equal(tf.parseWorkSeconds('01:30'), 3600 + 30 * 60);
  assert.equal(tf.parseWorkSeconds('00:01'), 60);
  assert.equal(tf.parseWorkSeconds('99:59'), 99 * 3600 + 59 * 60);
});

test('parseWorkSeconds: rejects zero, out-of-range, malformed', () => {
  assert.equal(tf.parseWorkSeconds('00:00'), null);
  assert.equal(tf.parseWorkSeconds('00:60'), null);
  assert.equal(tf.parseWorkSeconds('100:00'), null);
  assert.equal(tf.parseWorkSeconds('5:5'), null);
  assert.equal(tf.parseWorkSeconds(''), null);
  assert.equal(tf.parseWorkSeconds(null), null);
  assert.equal(tf.parseWorkSeconds('abc'), null);
});

test('parseBreakSeconds: valid mm:ss', () => {
  assert.equal(tf.parseBreakSeconds('05:00'), 300);
  assert.equal(tf.parseBreakSeconds('00:01'), 1);
  assert.equal(tf.parseBreakSeconds('59:59'), 59 * 60 + 59);
});

test('parseBreakSeconds: rejects zero/out-of-range', () => {
  assert.equal(tf.parseBreakSeconds('00:00'), null);
  assert.equal(tf.parseBreakSeconds('60:00'), null);
  assert.equal(tf.parseBreakSeconds('05:60'), null);
});

test('formatRemaining', () => {
  assert.equal(tf.formatRemaining(0), '00:00');
  assert.equal(tf.formatRemaining(5), '00:05');
  assert.equal(tf.formatRemaining(125), '02:05');
  assert.equal(tf.formatRemaining(3600), '1:00:00');
  assert.equal(tf.formatRemaining(3661), '1:01:01');
  assert.equal(tf.formatRemaining(-10), '00:00');
});

test('pad2', () => {
  assert.equal(tf.pad2(3), '03');
  assert.equal(tf.pad2(42), '42');
});
