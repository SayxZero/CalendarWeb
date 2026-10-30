// The sums of the levels of access on the presentation page, apart from the page
// so that the tests can reach them. Prices come from a file the operator types by
// hand: "1 200", "99,50" and 540 are all prices, anything else is none.

/** A price as a number, or null when it is empty, zero or not a number. */
export function priceValue(text) {
  const clean = String(text ?? '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 0 ? value : null;
}

/**
 * How many percent cheaper a month of the year comes out than a paid month,
 * rounded down so that the page never promises more than there is; null when it
 * is not cheaper by at least one percent or a price is missing.
 */
export function yearSaving(month, year) {
  if (month === null || year === null) return null;
  const twelve = month * 12;
  // The small addition is for sums like 1 - 0.9, which come out just under 10 %.
  const percent = Math.floor(((twelve - year) * 100) / twelve + 1e-9);
  return percent >= 1 ? percent : null;
}

/** A month of the year, in money: at most two decimals, none when it is whole. */
export function yearPerMonth(year) {
  return String(Math.round((year / 12) * 100) / 100).replace('.', ',');
}
