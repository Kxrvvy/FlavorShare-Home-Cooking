/* Ingredient amounts: what people type, what is stored, and what is shown.
 *
 * People write "2", "1/2", "1 1/2" - not "0.5". The database column is a
 * DECIMAL(6,2), so it cannot hold a fraction and returns every amount padded to
 * two places ("2.00", "250.00"). This module is the translation in both
 * directions: typed text -> the decimal that gets stored, and a stored decimal
 * -> the text that gets shown.
 *
 * Two decimal places cannot hold every fraction exactly (a third is stored as
 * 0.33), so display snaps a stored value to the nearest common fraction rather
 * than showing 0.33 back to someone who typed 1/3.
 */

/** What the DECIMAL(6,2) column can hold: up to 9999.99. */
export const MAX_QUANTITY = 9999.99;

const MAX_QUANTITY_TEXT_LENGTH = 10;

const VULGAR: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

/* The fractions a recipe actually uses, with the two-decimal value each is
 * stored as. Eighths, quarters, thirds and their neighbours cover measuring
 * cups and spoons; anything else is shown as a plain decimal. */
const FRACTIONS: { num: number; den: number }[] = [
  { num: 1, den: 8 }, { num: 1, den: 4 }, { num: 1, den: 3 }, { num: 3, den: 8 },
  { num: 1, den: 2 }, { num: 5, den: 8 }, { num: 2, den: 3 }, { num: 3, den: 4 },
  { num: 7, den: 8 },
];

/** Half a hundredth is the most storing to two places can move a value, and
 * 1/8 (0.125) is the largest gap between a fraction and its stored form. */
const SNAP_TOLERANCE = 0.006;

/** What the amount box should hold for whatever was just typed or pasted:
 * digits, a decimal point, a slash and single spaces - enough for 2, 2.5, 1/2
 * and 1 1/2. Whether what is left is a real amount is parseQuantity's call,
 * made on blur, not while typing (1/ has to be typeable on the way to 1/2). */
export function quantityText(value: string): string {
  let text = value;
  for (const [glyph, plain] of Object.entries(VULGAR)) text = text.split(glyph).join(` ${plain}`);

  return text
    .replace(/[^\d./ ]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ +/, "")
    .slice(0, MAX_QUANTITY_TEXT_LENGTH);
}

/** The number a piece of text means, or null if it is not an amount: "2",
 * "2.5", ".5", "1/2", "1 1/2". A zero denominator, a zero amount and anything
 * else unrecognisable are all null. */
export function parseQuantity(input: string): number | null {
  const text = quantityText(input).trim();
  if (!text) return null;

  let value: number | null = null;

  const plain = text.match(/^(\d+\.?\d*|\.\d+)$/);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  const mixed = text.match(/^(\d+) (\d+)\/(\d+)$/);

  if (plain) {
    value = Number(plain[1]);
  } else if (fraction) {
    value = Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  } else if (mixed) {
    value = Number(mixed[3]) === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }

  if (value === null || !Number.isFinite(value)) return null;
  return value;
}

/** The value to send to the API, as the string it expects ("0.5", "1.33"), or
 * null if the text is not an amount the column can hold: rounded to the two
 * places it stores, above zero, and no more than 9999.99. */
export function toApiQuantity(input: string): string | null {
  const value = parseQuantity(input);
  if (value === null) return null;

  const rounded = Math.round(value * 100) / 100;
  if (rounded <= 0 || rounded > MAX_QUANTITY) return null;

  return String(rounded);
}

/** The text to show for an amount - a stored "2.00", a typed "1/2" or a number:
 * whole numbers without decimals ("250"), common fractions as fractions
 * ("1/2", "1 1/2"), anything else as a plain decimal with no trailing zeros
 * ("0.4"). Text that is not an amount comes back as it was. */
export function formatQuantity(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  const raw = String(input).trim();
  if (!raw) return "";

  const parsed = parseQuantity(raw);
  if (parsed === null) return raw;

  const value = Math.round(parsed * 100) / 100;
  const whole = Math.floor(value);
  const remainder = value - whole;

  if (remainder < 0.005) return String(whole);

  const match = FRACTIONS.find(({ num, den }) => Math.abs(remainder - num / den) <= SNAP_TOLERANCE);
  if (match) {
    const part = `${match.num}/${match.den}`;
    return whole > 0 ? `${whole} ${part}` : part;
  }

  return String(value);
}
