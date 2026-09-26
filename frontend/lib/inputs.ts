/* Input constraints for the recipe builder: what a field will and will not
 * accept as it is typed, kept apart from the component so each rule can be
 * read - and tested - on its own.
 *
 * Every helper here takes what the input currently holds and returns what it
 * should hold instead, so an onChange handler is `set(rule(e.target.value))`.
 * A rejected character never reaches state, which is why nothing has to be
 * cleaned up on blur.
 */

/** Description and "More about this recipe". Mirrored by MAX_TEXT_WORDS in
 * recipes/serializers.py - change one and the other has to follow. */
export const MAX_WORDS = 300;

/** Words as whitespace-separated runs of non-space characters, the same
 * definition the backend counts with (str.split()). */
export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** The text cut off just after its `max`-th word. Everything before that point
 * is kept exactly as typed - spacing, blank lines and all - so trimming an
 * over-long paste never reflows what was already fine. */
export function limitWords(text: string, max: number = MAX_WORDS): string {
  let count = 0;
  for (const match of text.matchAll(/\S+/g)) {
    count += 1;
    if (count === max + 1) return text.slice(0, match.index).trimEnd();
  }
  return text;
}

/** Digits and nothing else - servings. */
export function digitsOnly(value: string, maxLength = 3): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

/* Prep and cook time: a masked HH:MM field, the way a card's expiry date is
 * entered. Digits only, the colon put in for you, and a minutes value that
 * cannot exceed 59 - a third digit above 5 becomes 0 + that digit, the way an
 * expiry field turns a month of 2 into 02. */

/** What the field should show for whatever was just typed or pasted. */
export function maskTime(raw: string): string {
  let digits = raw.replace(/\D/g, "").slice(0, 4);

  if (digits.length >= 3 && Number(digits[2]) > 5) {
    digits = `${digits.slice(0, 2)}0${digits.slice(2)}`.slice(0, 4);
  }

  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** True once all four digits are in, which is what a save needs. */
export function isCompleteTime(mask: string): boolean {
  return /^\d{2}:\d{2}$/.test(mask);
}

/** Total minutes for a complete mask; 00:00 means "not stated" and is null. */
export function timeToMinutes(mask: string): number | null {
  if (!isCompleteTime(mask)) return null;
  const [hours, minutes] = mask.split(":").map(Number);
  return hours * 60 + minutes || null;
}

/** The mask for a stored number of minutes. Past 99:59 - which the field
 * cannot type - it stops at 99:59 rather than showing a wrong number. */
export function minutesToTime(total: number | null): string {
  if (total === null || total <= 0) return "";
  const capped = Math.min(total, 99 * 60 + 59);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(capped / 60))}:${pad(capped % 60)}`;
}

/* The three text boxes below (cuisine, unit, ingredient name) are capped here
 * and deliberately carry no maxLength attribute. The browser counts every
 * character it was given, digits included, and cuts a paste to that length
 * before any onChange runs - so a pasted "a1b2a1b2..." would lose half its
 * letters to characters that were about to be stripped anyway. These helpers
 * strip first and then cut, which gives the full length in letters. */

/* A cuisine typed under "Other". The list exists so "Filipino" and "filipino"
 * stop being two different things to the Explore filter, so what is typed here
 * is tidied the same way: letters, spaces, hyphens and apostrophes only, one
 * word-per-capital, and snapped to the list's own spelling when it matches. */

export const MAX_CUISINE_LENGTH = 30;

/** What the text box should hold for whatever was just typed or pasted. */
export function cuisineText(value: string): string {
  return value
    .replace(/[^\p{L}\s'-]/gu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+/, "")
    .slice(0, MAX_CUISINE_LENGTH);
}

/** The value to store: trimmed, each word capitalised (hawaiian -> Hawaiian,
 * tex-mex -> Tex-Mex), and replaced by the list's own spelling when it is one
 * of `known` - so a typed "filipino" cannot become a second Filipino. The
 * word "other" is the dropdown's own label, not a cuisine, and stores nothing. */
export function normaliseCuisine(value: string, known: readonly string[]): string {
  const words = value.trim().replace(/\s+/g, " ");
  if (!words || words.toLowerCase() === "other") return "";

  const titled = words
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());

  return known.find((name) => name.toLowerCase() === titled.toLowerCase()) ?? titled;
}

/** An ingredient unit: no numbers of any kind (the amount box is for those -
 * "2 cups" here would print as "2 2 cups"), capped at 20 characters.
 * Mirrored by MAX_UNIT_LENGTH in recipes/serializers.py. */
export const MAX_UNIT_LENGTH = 20;

export function unitText(value: string): string {
  return value.replace(/\p{N}/gu, "").slice(0, MAX_UNIT_LENGTH);
}

/** An ingredient's name: no numbers of any kind (the amount has its own box, so
 * a digit here is nearly always the amount typed into the wrong one), capped at
 * the column's 100 characters. Mirrored by validate_ingredient_name in
 * recipes/serializers.py. */
export const MAX_INGREDIENT_NAME_LENGTH = 100;

export function ingredientNameText(value: string): string {
  return value.replace(/\p{N}/gu, "").slice(0, MAX_INGREDIENT_NAME_LENGTH);
}
