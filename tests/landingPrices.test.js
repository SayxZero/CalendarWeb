import test from 'node:test';
import assert from 'node:assert/strict';
import { priceValue, yearPerMonth, yearSaving } from '../site/js/landingPrices.js';

test('a price is read the way people type it', () => {
  assert.equal(priceValue('50'), 50);
  assert.equal(priceValue(540), 540);
  assert.equal(priceValue('1 200'), 1200);
  assert.equal(priceValue('99,50'), 99.5);
  for (const none of ['', null, undefined, '0', 'скоро', '-5', '1.2.3']) assert.equal(priceValue(none), null, String(none));
});

test('the year is cheaper by whole percents, rounded down', () => {
  assert.equal(yearSaving(50, 540), 10);
  assert.equal(yearSaving(100, 900), 25);
  assert.equal(yearSaving(50, 590), 1);      // 1.66 %
  assert.equal(yearSaving(500, 5400), 10);   // no float dust under ten
});

test('a year that is not cheaper has no saving to show', () => {
  assert.equal(yearSaving(50, 600), null);   // the same
  assert.equal(yearSaving(50, 700), null);   // dearer
  assert.equal(yearSaving(50, 599), null);   // less than one percent
  assert.equal(yearSaving(null, 540), null);
  assert.equal(yearSaving(50, null), null);
});

test('a month of the year in money', () => {
  assert.equal(yearPerMonth(540), '45');
  assert.equal(yearPerMonth(1000), '83,33');
});
