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
 * Whether a character can be part of an identifier in both C# and TypeScript: a letter, a combining
 * mark (Mn, Mc), a decimal digit or a letter-like number, that ECMAScript also allows (ID_Continue).
 */
const identifierPart = (char: string): boolean =>
  /[\p{L}\p{Mn}\p{Mc}\p{Nd}\p{Nl}]/u.test(char) && /\p{ID_Continue}/u.test(char);

/**
 * Turns any JSON key into PascalCase words: "home address" → HomeAddress, "HOME_ADDRESS" →
 * HomeAddress, "2fa" → Item2fa. Words are runs of identifier characters (see identifierPart);
 * everything else separates them, so the result is a valid identifier in C# and TypeScript.
 */
export function pascalCase(key: string): string {
  const separated = key.normalize('NFC').replace(/./gsu, (char) => (identifierPart(char) ? char : ' '));
  const words = separated
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, '$1 $2')
    .split(' ')
    .filter((word) => /^[\p{L}\p{Nd}\p{Nl}]/u.test(word))
    // Words in capitals longer than an acronym read as ordinary words: HOME → Home, but ID stays.
    .map((word) =>
      word.length > 2 && word === word.toUpperCase() && /\p{Lu}/u.test(word) ? word.toLowerCase() : word,
    );
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (name === '') return 'Item';
  return /^\p{Nd}/u.test(name) ? `Item${name}` : name;
}

/** A type name for a JSON key: pascalCase, kept off the built-in names. */
export function typeName(key: string): string {
  return avoidReserved(pascalCase(key));
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
  statuses: 'status',
  viruses: 'virus',
  campuses: 'campus',
  bonuses: 'bonus',
  censuses: 'census',
  beaches: 'beach',
  coaches: 'coach',
  peaches: 'peach',
  approaches: 'approach',
  heroes: 'hero',
  potatoes: 'potato',
  tomatoes: 'tomato',
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
  // Items2 → Item2: singular of the words, then the number back.
  const numbered = /^(.*\D)(\d+)$/.exec(name);
  if (numbered) return singular(numbered[1] ?? '') + (numbered[2] ?? '');
  if (name.endsWith('Item')) return name;

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
  // Boxes, Addresses, Wishes, Buzzes, and -ches after t, n or r (Matches, Branches, Churches).
  // Other -ches and -uses lose only the s: Caches, Niches, Houses, Causes.
  if (/(?:ss|x|sh|zz|[tnr]ch)es$/.test(lower)) return restore(lower.slice(0, -2));
  if (/[^isu]s$/.test(lower)) return restore(lower.slice(0, -1));
  return `${name}Item`;
}
