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
  'ArrayBuffer',
  'Attribute',
  'Awaited',
  'BigInt',
  'BigInteger',
  'Blob',
  'Boolean',
  'Buffer',
  'Byte',
  'Char',
  'Console',
  'Date',
  'DateOnly',
  'DateTime',
  'DateTimeOffset',
  'Decimal',
  'Dictionary',
  'Document',
  'Double',
  'Element',
  'Enum',
  'Environment',
  'Error',
  'Event',
  'Exception',
  'Exclude',
  'Extract',
  'File',
  'Func',
  'Function',
  'Guid',
  'Half',
  'Headers',
  'Index',
  'Int128',
  'Int16',
  'Int32',
  'Int64',
  'Intl',
  'Iterable',
  'Json',
  'JsonElement',
  'JsonNode',
  'List',
  'Location',
  'Map',
  'Math',
  'Node',
  'Nullable',
  'Number',
  'Object',
  'Omit',
  'Partial',
  'Pick',
  'Promise',
  'Proxy',
  'Random',
  'Range',
  'Readonly',
  'Record',
  'Reflect',
  'RegExp',
  'Request',
  'Required',
  'Response',
  'ReturnType',
  'Set',
  'Single',
  'Stream',
  'String',
  'Symbol',
  'System',
  'Task',
  'TimeOnly',
  'TimeSpan',
  'Tuple',
  'Type',
  'Uint8Array',
  'Uri',
  'URL',
  'Version',
  'Void',
  'WeakMap',
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

/** Capitalises a word's first letter, unless that would change its length (ß → SS). */
function capitalise(word: string): string {
  const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
  const upper = first.toUpperCase();
  return (upper.length === first.length ? upper : first) + word.slice(first.length);
}

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
    // A word can't start with a combining mark; drop the marks, keep the rest.
    .map((word) => word.replace(/^[\p{Mn}\p{Mc}]+/u, ''))
    .filter((word) => word !== '')
    // Words in capitals longer than an acronym read as ordinary words: HOME → Home, but ID stays.
    .map((word) =>
      word.length > 2 && word === word.toUpperCase() && /\p{Lu}/u.test(word) ? word.toLowerCase() : word,
    );
  const name = words.map(capitalise).join('');
  if (name === '') return 'Item';
  return /^\p{Nd}/u.test(name) ? `Item${name}` : name;
}

/** A type name for a JSON key: pascalCase, kept off the built-in names. */
export function typeName(key: string): string {
  return avoidReserved(pascalCase(key));
}

// Maps rather than object literals, so keys such as "constructor" or "__proto__" are just words.
const IRREGULAR = new Map(
  Object.entries({
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
    diagnoses: 'diagnosis',
    theses: 'thesis',
    crises: 'crisis',
    movies: 'movie',
    cookies: 'cookie',
    zombies: 'zombie',
    calories: 'calorie',
    ties: 'tie',
    pies: 'pie',
    lies: 'lie',
    gases: 'gas',
    quizzes: 'quiz',
    buses: 'bus',
    statuses: 'status',
    viruses: 'virus',
    campuses: 'campus',
    bonuses: 'bonus',
    censuses: 'census',
    aliases: 'alias',
    canvases: 'canvas',
    lenses: 'lens',
    heroes: 'hero',
    potatoes: 'potato',
    tomatoes: 'tomato',
    echoes: 'echo',
    leaves: 'leaf',
    lives: 'life',
    wives: 'wife',
    knives: 'knife',
    halves: 'half',
    shelves: 'shelf',
    wolves: 'wolf',
    thieves: 'thief',
    rookies: 'rookie',
    selfies: 'selfie',
    smoothies: 'smoothie',
    brownies: 'brownie',
    goalies: 'goalie',
    phenomena: 'phenomenon',
    axes: 'axis',
    apis: 'api',
    // -che words, whose plural only adds an s.
    caches: 'cache',
    niches: 'niche',
    headaches: 'headache',
    avalanches: 'avalanche',
    moustaches: 'moustache',
    mustaches: 'mustache',
    cliches: 'cliche',
    quiches: 'quiche',
    psyches: 'psyche',
  }),
);

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
  // Items2 → Item2: the singular of the words, then the number back; Level2 → Level2Item.
  const numbered = /^(.*\D)(\d+)$/.exec(name);
  if (numbered) {
    const words = numbered[1] ?? '';
    const base = singular(words);
    return base === `${words}Item` ? `${name}Item` : base + (numbered[2] ?? '');
  }
  if (name.endsWith('Item')) return name;

  const split = /^(.*?)(\p{Lu}[^\p{Lu}]*)$/u.exec(name);
  const head = split?.[1] ?? '';
  const last = split?.[2] ?? name;
  const lower = last.toLowerCase();
  const restore = (word: string): string => head + last.charAt(0) + word.slice(1);

  const irregular = IRREGULAR.get(lower);
  if (irregular !== undefined) return restore(irregular);
  if (UNCOUNTABLE.has(lower)) return `${name}Item`;
  // An acronym in the plural: URLs → URL, UserIDs → UserID. One all in capitals (GPS) is left alone.
  if (/\p{Lu}{2,}s$/u.test(name)) return name.slice(0, -1);
  if (last.length > 1 && last === last.toUpperCase()) return `${name}Item`;
  if (lower.length < 3) return `${name}Item`;
  // A short acronym folded to lower case by pascalCase: Gps, Sms, Dns, Cms.
  if (/^[^aeiouy]+s$/.test(lower)) return `${name}Item`;
  if (/[^aeiou]ies$/.test(lower)) return restore(`${lower.slice(0, -3)}y`);
  // Boxes, Addresses, Wishes, Buzzes, Matches, Speeches; the -che words are in IRREGULAR.
  if (/(?:ss|x|sh|zz|ch)es$/.test(lower)) return restore(lower.slice(0, -2));
  // Not plurals: Analysis, Status, Canvas, Lens, Class.
  if (/(?:is|us|as|ns|ss)$/.test(lower)) return `${name}Item`;
  if (lower.endsWith('s')) return restore(lower.slice(0, -1));
  return `${name}Item`;
}
