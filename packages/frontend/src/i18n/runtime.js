/**
 * The current language for code that runs outside React -- the chain layer
 * (lib/chain/*.js) throws errors the UI shows as-is. LocaleProvider keeps this
 * in step with the language picker.
 */

let current = "en";

export const setRuntimeLocale = (locale) => {
  current = locale === "en" ? "en" : "tr";
};

export const getRuntimeLocale = () => current;

/** Pick the message for the current language. */
export const tl = (tr, en) => (current === "en" ? en : tr);
