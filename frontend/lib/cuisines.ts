/* The cuisines a recipe can be filed under in the builder: Filipino, Italian,
 * and so on - a style of food, not a country of origin.
 *
 * A fixed list rather than free text so "Filipino", "filipino" and "Pinoy"
 * stop being three different things to the Explore page's cuisine filter, which
 * is built from whatever values recipes actually carry.
 *
 * It covers every area TheMealDB tags its recipes with, in the adjective form
 * most of them already use, plus the common styles that are not one country
 * (Mediterranean, Middle Eastern, Caribbean, Fusion). OTHER_CUISINE is the way
 * out for anything not here: the builder shows a text box for it, and what is
 * typed there is what gets stored - the word "Other" itself never is. Stored
 * exactly as written; Recipe.cuisine_type is a 50-character string and every
 * entry is well inside that.
 */

/** The dropdown's escape hatch. A trigger for the text box, not a value. */
export const OTHER_CUISINE = "Other";

export const CUISINES = [
  "Afghan",
  "African",
  "Algerian",
  "American",
  "Argentine",
  "Armenian",
  "Australian",
  "Austrian",
  "Bangladeshi",
  "Belgian",
  "Brazilian",
  "British",
  "Bulgarian",
  "Cambodian",
  "Canadian",
  "Caribbean",
  "Chilean",
  "Chinese",
  "Colombian",
  "Croatian",
  "Cuban",
  "Czech",
  "Danish",
  "Dutch",
  "Egyptian",
  "Ethiopian",
  "Filipino",
  "Finnish",
  "French",
  "Georgian",
  "German",
  "Greek",
  "Hungarian",
  "Indian",
  "Indonesian",
  "Iranian",
  "Irish",
  "Israeli",
  "Italian",
  "Jamaican",
  "Japanese",
  "Kenyan",
  "Korean",
  "Lebanese",
  "Malaysian",
  "Mediterranean",
  "Mexican",
  "Middle Eastern",
  "Moroccan",
  "Nepalese",
  "Nigerian",
  "Norwegian",
  "Pakistani",
  "Peruvian",
  "Polish",
  "Portuguese",
  "Russian",
  "Saudi",
  "Singaporean",
  "Slovak",
  "South African",
  "Spanish",
  "Sri Lankan",
  "Swedish",
  "Swiss",
  "Syrian",
  "Taiwanese",
  "Thai",
  "Tunisian",
  "Turkish",
  "Ukrainian",
  "Uruguayan",
  "Venezuelan",
  "Vietnamese",
  "Fusion",
] as const;
