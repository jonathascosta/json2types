/**
 * Type names from JSON keys: PascalCase identifiers that are valid in C# and TypeScript, that don't
 * shadow common built-in types, and singular for the items of an array.
 */

/**
 * Names that would shadow a built-in or very common type in C# or TypeScript (`class String`,
 * `interface Date`) and confuse anyone reading the generated code, plus the attributes the C#
 * output writes (a class JsonPropertyName would make [JsonPropertyName] ambiguous, CS1614) and the
 * namespaces it uses (a global class Newtonsoft would hide the one in `using Newtonsoft.Json;`).
 * Deliberately not exhaustive:
 * the TypeScript output is a module, so other globals aren't merged into.
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
  'Capitalize',
  'Char',
  'Comment',
  'Console',
  'DataView',
  'Date',
  'DateOnly',
  'DateTime',
  'DateTimeOffset',
  'Decimal',
  'Delegate',
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
  'Float32Array',
  'Float64Array',
  'Func',
  'Function',
  'Generator',
  'Guid',
  'Half',
  'Headers',
  'History',
  'Image',
  'Index',
  'InstanceType',
  'Int128',
  'Int16',
  'Int16Array',
  'Int32',
  'Int32Array',
  'Int64',
  'Int8Array',
  'Intl',
  'IntPtr',
  'Iterable',
  'Iterator',
  'Json',
  'JsonConstructor',
  'JsonConverter',
  'JsonDerivedType',
  'JsonElement',
  'JsonExtensionData',
  'JsonIgnore',
  'JsonInclude',
  'JsonNode',
  'JsonPolymorphic',
  'JsonProperty',
  'JsonPropertyName',
  'JsonRequired',
  'JsonSerializer',
  'Lazy',
  'List',
  'Location',
  'Lowercase',
  'Map',
  'Math',
  'Memory',
  'Newtonsoft',
  'Node',
  'NonNullable',
  'Nullable',
  'Number',
  'Object',
  'Obsolete',
  'Omit',
  'Option',
  'Parameters',
  'Partial',
  'Pick',
  'Position',
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
  'SByte',
  'Selection',
  'Serializable',
  'Set',
  'Single',
  'Span',
  'Storage',
  'Stream',
  'String',
  'Symbol',
  'System',
  'Task',
  'Text',
  'ThisType',
  'Thread',
  'TimeOnly',
  'TimeSpan',
  'Tuple',
  'Type',
  'UInt16',
  'Uint16Array',
  'UInt32',
  'Uint32Array',
  'UInt64',
  'Uint8Array',
  'Uppercase',
  'Uri',
  'URL',
  'ValueTuple',
  'Version',
  'Void',
  'WeakMap',
  'Window',
]);

/** Appends Item to names that would shadow a common built-in type: String → StringItem. */
export function avoidReserved(name: string): string {
  // C# finds [JsonIgnore] as JsonIgnore or JsonIgnoreAttribute, so the long form is reserved too.
  const stem = name.endsWith('Attribute') ? name.slice(0, -'Attribute'.length) : null;
  return RESERVED.has(name) || (stem !== null && RESERVED.has(stem)) ? `${name}Item` : name;
}

/** Capitalises a word's first letter, unless that would change its length (ß → SS). */
function capitalise(word: string): string {
  const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
  const upper = first.toUpperCase();
  return (upper.length === first.length ? upper : first) + word.slice(first.length);
}

/**
 * Turns any JSON key into PascalCase words: "home address" → HomeAddress, "HOME_ADDRESS" →
 * HomeAddress, "2fa" → Item2fa. Words are runs of characters valid in identifiers in both languages (letters, Mn and Mc marks,
 * decimal digits, letter numbers, all within ECMAScript's ID_Continue);
 * everything else separates them, so the result is a valid identifier in C# and TypeScript.
 */
export function pascalCase(key: string): string {
  // Two passes instead of a callback per character: outside the C# classes, then outside ID_Continue.
  // Characters outside the Basic Multilingual Plane are separators too: C# reads identifiers one
  // UTF-16 unit at a time and rejects surrogate pairs (CS1056), even for letters such as 𠀀.
  const separated = key
    .normalize('NFC')
    .replace(/[\u{10000}-\u{10FFFF}]/gu, ' ')
    .replace(/[^\p{L}\p{Mn}\p{Mc}\p{Nd}\p{Nl}]/gu, ' ')
    .replace(/\P{ID_Continue}/gu, ' ');
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
  // C# rejects identifiers over 511 characters (CS0645); 100 is plenty, and numbering keeps names
  // that meet after the cut apart.
  const name = Array.from(words.map(capitalise).join('')).slice(0, 100).join('');
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
    tornadoes: 'tornado',
    cactuses: 'cactus',
    octopuses: 'octopus',
    syllabuses: 'syllabus',
    christmases: 'christmas',
    busses: 'bus',
    plusses: 'plus',
    fezzes: 'fez',
    wifis: 'wifi',
    does: 'doe',
    tvs: 'tv',
    octopi: 'octopus',
    hippies: 'hippie',
    genies: 'genie',
    aunties: 'auntie',
    zeroes: 'zero',
    gasses: 'gas',
    fezes: 'fez',
    oxen: 'ox',
    emojis: 'emoji',
    wikis: 'wiki',
    skis: 'ski',
    kiwis: 'kiwi',
    taxis: 'taxi',
    minis: 'mini',
    unis: 'uni',
    kpis: 'kpi',
    dies: 'die',
    atlases: 'atlas',
    biases: 'bias',
    focuses: 'focus',
    hypotheses: 'hypothesis',
    synopses: 'synopsis',
    parentheses: 'parenthesis',
    emphases: 'emphasis',
    oases: 'oasis',
    waltzes: 'waltz',
    dwarves: 'dwarf',
    appendices: 'appendix',
    dominoes: 'domino',
    mangoes: 'mango',
    mosquitoes: 'mosquito',
    torpedoes: 'torpedo',
    vetoes: 'veto',
    cargoes: 'cargo',
    hoodies: 'hoodie',
    veggies: 'veggie',
    pixies: 'pixie',
    aches: 'ache',
    clothes: 'clothing',
    blitzes: 'blitz',
    elves: 'elf',
    loaves: 'loaf',
    radii: 'radius',
    cacti: 'cactus',
    alumni: 'alumnus',
    fungi: 'fungus',
    nuclei: 'nucleus',
    stimuli: 'stimulus',
    bacteria: 'bacterium',
    curricula: 'curriculum',
    menus: 'menu',
    gurus: 'guru',
    emus: 'emu',
    haikus: 'haiku',
    volcanoes: 'volcano',
    calves: 'calf',
    selves: 'self',
    hooves: 'hoof',
    scarves: 'scarf',
    prairies: 'prairie',
    freebies: 'freebie',
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

/** Words that end in s but aren't plurals; other -as and -ns words are (Ideas, Columns). */
const SINGULAR_IN_S = new Set([
  'alias',
  'atlas',
  'aws',
  'bias',
  'canvas',
  'chaos',
  'christmas',
  'cos',
  'ethos',
  'gas',
  'goes',
  'has',
  'ios',
  'its',
  'kudos',
  'lens',
  'means',
  'pants',
  'pathos',
  'plus',
  'pos',
  'texas',
  'this',
  'tos',
  'was',
  'yes',
]);

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
  'analytics',
  'statistics',
  'physics',
  'mathematics',
  'economics',
  'politics',
  'ethics',
  'electronics',
  'logistics',
  'gymnastics',
  'scissors',
  'thanks',
  'headquarters',
  'crossroads',
  'odds',
  'pants',
]);

/**
 * The name for one item of an array called `name`: Items → Item, Categories → Category,
 * Addresses → Address, People → Person. When there is no clear singular (Data, Status, List),
 * the result is the name followed by Item. Pass the result through avoidReserved: Errors → Error.
 */
export function singular(name: string): string {
  // Scans rather than regexes on the whole name: patterns like /\p{Lu}{2,}s$/ backtrack
  // quadratically on a long run of capitals, and a key can be a megabyte long.
  let digitsStart = name.length;
  while (digitsStart > 0 && /\d/.test(name.charAt(digitsStart - 1))) digitsStart--;
  if (digitsStart > 0 && digitsStart < name.length) {
    // Items2 → Item2: the singular of the words, then the number back; Level2 → Level2Item.
    const words = name.slice(0, digitsStart);
    const base = singular(words);
    return base === `${words}Item` ? `${name}Item` : base + name.slice(digitsStart);
  }
  if (name.endsWith('Item')) return name;

  const chars = Array.from(name);
  const isUpper = (char: string | undefined): boolean => char !== undefined && /\p{Lu}/u.test(char);
  let lastWord = chars.length - 1;
  while (lastWord > 0 && !isUpper(chars[lastWord])) lastWord--;
  const head = chars.slice(0, lastWord).join('');
  const last = chars.slice(lastWord).join('');
  const lower = last.toLowerCase();
  // Some letters change length when lower-cased (İ); there's no safe singular to build then.
  if (lower.length !== last.length) return `${name}Item`;
  const first = chars[lastWord] ?? '';
  const restore = (word: string): string => head + first + word.slice(first.length);

  const irregular = IRREGULAR.get(lower);
  if (irregular !== undefined) return restore(irregular);
  if (UNCOUNTABLE.has(lower)) return `${name}Item`;
  // An acronym in the plural: URLs → URL, UserIDs → UserID. One all in capitals (GPS) is left alone.
  if (chars.at(-1) === 's' && isUpper(chars.at(-2)) && isUpper(chars.at(-3))) return name.slice(0, -1);
  if (last.length > 1 && last === last.toUpperCase()) return `${name}Item`;
  if (lower.length < 3) return `${name}Item`;
  // A short acronym folded to lower case by pascalCase: Gps, Sms, Dns, Cms.
  if (/^[^aeiouy]+s$/.test(lower)) return `${name}Item`;
  if (/[^aeiou]ies$/.test(lower)) return restore(`${lower.slice(0, -3)}y`);
  // Plateaus, Bureaus.
  if (lower.endsWith('eaus')) return restore(lower.slice(0, -1));
  // Boxes, Addresses, Wishes, Buzzes, Matches, Speeches; the -che words are in IRREGULAR.
  if (/(?:ss|x|sh|zz|ch)es$/.test(lower)) return restore(lower.slice(0, -2));
  // Not plurals: Analysis, Class, Status, Bus; the plurals among -us words (Menus) are in IRREGULAR.
  if (/(?:is|ss|us)$/.test(lower) || SINGULAR_IN_S.has(lower)) return `${name}Item`;
  if (lower.endsWith('s')) return restore(lower.slice(0, -1));
  return `${name}Item`;
}
