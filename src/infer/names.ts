/**
 * Type names from JSON keys: PascalCase identifiers that are valid in C# and TypeScript, that don't
 * shadow common built-in types, and singular for the items of an array.
 */

/**
 * Names that would shadow a built-in or very common type in C# or TypeScript (`class String`,
 * `interface Date`) and confuse anyone reading the generated code.
 */
const RESERVED = new Set([
  'Action',
  'Array',
  'Attribute',
  'Boolean',
  'Byte',
  'Char',
  'Console',
  'Date',
  'DateTime',
  'Decimal',
  'Dictionary',
  'Document',
  'Double',
  'Element',
  'Enum',
  'Error',
  'Event',
  'Exception',
  'Func',
  'Function',
  'Guid',
  'Int16',
  'Int32',
  'Int64',
  'Json',
  'List',
  'Map',
  'Math',
  'Node',
  'Nullable',
  'Number',
  'Object',
  'Promise',
  'Record',
  'Response',
  'Request',
  'Set',
  'Single',
  'String',
  'Symbol',
  'Task',
  'Type',
  'Uri',
  'Void',
  'Window',
]);

/** Appends Item to names that would shadow a common built-in type: String → StringItem. */
export function avoidReserved(name: string): string {
  return RESERVED.has(name) ? `${name}Item` : name;
}

/**
 * Turns any JSON key into a PascalCase type name: "home address" → HomeAddress, "2fa" → Item2fa.
 * Words are letters (with their accents), decimal digits and letter-like numbers; everything else
 * separates them, so the result is a valid identifier in C# and TypeScript.
 */
export function typeName(key: string): string {
  const words = key
    .normalize('NFC')
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{M}\p{Nd}\p{Nl}]+/u)
    .filter((word) => /^[\p{L}\p{Nd}\p{Nl}]/u.test(word));
  let name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (name === '') return 'Item';
  if (/^\p{Nd}/u.test(name)) name = `Item${name}`;
  return avoidReserved(name);
}

const IRREGULAR: Readonly<Record<string, string>> = {
  people: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  mice: 'mouse',
  geese: 'goose',
  feet: 'foot',
  teeth: 'tooth',
  indices: 'index',
  matrices: 'matrix',
  vertices: 'vertex',
  criteria: 'criterion',
  analyses: 'analysis',
  movies: 'movie',
  cookies: 'cookie',
  zombies: 'zombie',
  ties: 'tie',
  pies: 'pie',
  gases: 'gas',
  quizzes: 'quiz',
  buses: 'bus',
};

/** Words that are the same in the plural, or have no singular worth using. */
const UNCOUNTABLE = new Set([
  'data',
  'metadata',
  'info',
  'information',
  'news',
  'series',
  'species',
  'equipment',
  'feedback',
  'media',
  'status',
  'settings',
]);

/**
 * The name for one item of an array called `name`: Items → Item, Categories → Category,
 * Addresses → Address, People → Person. When there is no clear singular (Data, Status, List),
 * the result is the name followed by Item. Pass the result through avoidReserved: Errors → Error.
 */
export function singular(name: string): string {
  const split = /^(.*?)(\p{Lu}[^\p{Lu}]*)$/u.exec(name);
  const head = split?.[1] ?? '';
  const last = split?.[2] ?? name;
  const lower = last.toLowerCase();
  const restore = (word: string): string => head + last.charAt(0) + word.slice(1);

  const irregular = IRREGULAR[lower];
  if (irregular) return restore(irregular);
  if (UNCOUNTABLE.has(lower)) return `${name}Item`;
  // An acronym in the plural: URLs → URL, UserIDs → UserID.
  if (/\p{Lu}{2,}s$/u.test(name)) return name.slice(0, -1);
  if (lower.length < 3) return `${name}Item`;
  if (/[^aeiou]ies$/.test(lower)) return restore(`${lower.slice(0, -3)}y`);
  if (/(?:ss|x|ch|sh|zz|us)es$/.test(lower)) return restore(lower.slice(0, -2));
  if (/[^isu]s$/.test(lower)) return restore(lower.slice(0, -1));
  return `${name}Item`;
}
