/**
 * Characters that can't be seen, or that change how the source reads, so string literals escape
 * them: controls, format characters (bidirectional overrides included), every space but the plain
 * one, default-ignorable code points (variation selectors, Hangul fillers, the combining grapheme
 * joiner) and the braille blank.
 */
export const INVISIBLE_SOURCE = '(?! )[\\p{Cc}\\p{Cf}\\p{Z}\\p{Default_Ignorable_Code_Point}\\u2800]';

/**
 * `\u` escapes for each UTF-16 unit of a character, both halves of a surrogate pair included:
 * U+E0041 is `\udb40\udc41`. Lowercase, as JSON.stringify writes them, unless `upper`.
 */
export function unicodeEscape(character: string, upper = false): string {
  let escaped = '';
  for (let i = 0; i < character.length; i++) {
    const hex = character.charCodeAt(i).toString(16).padStart(4, '0');
    escaped += `\\u${upper ? hex.toUpperCase() : hex}`;
  }
  return escaped;
}
