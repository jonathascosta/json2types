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
