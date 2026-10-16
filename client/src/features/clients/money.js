/** Rates are stored as integer MINOR units (e.g. paise/cents). People type "1500.50"; these convert without float errors. */
export const exponentOf = (currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
};

/** "1,500.5" -> 150050 (for a 2-decimal currency). Returns null when the text is not a valid non-negative amount. */
export function toMinor(text, currency) {
  const e = exponentOf(currency);
  const clean = String(text ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  if (frac.length > e) return null; // more decimals than the currency has
  const minor = Number(whole) * 10 ** e + Number(frac.padEnd(e, '0') || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 150050 -> "1500.50" for an input box. */
export function toMajorText(minor, currency) {
  if (minor == null) return '';
  const e = exponentOf(currency);
  return (minor / 10 ** e).toFixed(e);
}
