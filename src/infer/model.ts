/**
 * A language-neutral description of the types a JSON sample implies. The generators (C#,
 * TypeScript) read this; none of it knows about any target language.
 */

export type TypeRef =
  | { readonly kind: 'string' }
  /**
   * Strings that were always strict ISO 8601 date-times, e.g. 2026-10-18T12:00:00Z. `offset` says
   * whether they carried a time zone (Z or ±hh:mm): always, never, or only some of them. Dates
   * mixed in count as having none.
   */
  | { readonly kind: 'dateTime'; readonly offset: 'always' | 'never' | 'mixed' }
  /** Strings that were always ISO 8601 dates, e.g. 2026-10-18. */
  | { readonly kind: 'date' }
  /** Strings that were always GUIDs, e.g. 3f2504e0-4f89-11d3-9a0c-0305e82c3301. */
  | { readonly kind: 'guid' }
  /**
   * Whole numbers; `bits` is the smallest signed size that holds every one seen, or 'big' past 128.
   * `unsafe` is set when some are beyond ±2^53, where a double (a JavaScript number) skips some.
   */
  | { readonly kind: 'integer'; readonly bits: 32 | 64 | 128 | 'big'; readonly unsafe?: true }
  /**
   * Numbers with a fraction or an exponent, all within an exact decimal's range (±7.9×10²⁸, down to
   * 1e-28). Only the range is checked: digits beyond a decimal's 28–29 are rounded.
   */
  | { readonly kind: 'decimal' }
  /** Numbers with a fraction or an exponent, some beyond an exact decimal's range: floating point. */
  | { readonly kind: 'float' }
  | { readonly kind: 'boolean' }
  /** Nothing to infer from (only nulls, an empty array) or values of different kinds. */
  | { readonly kind: 'any' }
  /** `items.nullable` is true when some items were null. */
  | { readonly kind: 'array'; readonly items: PropertyType }
  /** A declared object type, by name. */
  | { readonly kind: 'object'; readonly name: string };

export interface PropertyType {
  readonly type: TypeRef;
  /** Null in at least one sample. */
  readonly nullable: boolean;
}

export interface Property extends PropertyType {
  /** The name as it appears in the JSON, unchanged. */
  readonly jsonName: string;
  /**
   * A PascalCase member name for languages that rename members (C#): unique within its type and
   * never the type's own name, which C# forbids (first_name → FirstName; "a" and "A" → A, A2).
   */
  readonly name: string;
  /** Missing from at least one of the objects merged into this type. */
  readonly optional: boolean;
}

export interface ObjectDeclaration {
  /** A PascalCase identifier, unique in the model. */
  readonly name: string;
  /** In the order they were first seen. */
  readonly properties: readonly Property[];
}

export interface Diagnostic {
  /**
   * Where in the JSON, as a JSONPath for display: `$`, `$.items[*].tags`. Long keys are shortened
   * (…), keys that then meet are numbered (#2), and lone surrogates are shown as U+FFFD, so such a
   * path reads well but may not select the member it describes.
   */
  readonly path: string;
  readonly severity: 'warning' | 'info';
  readonly message: string;
  /**
   * How many times it happened there, e.g. once per item of an array. For a repeated key, each
   * repeat counts: a key three times in one object counts 2.
   */
  readonly count: number;
}

export interface Model {
  readonly root: PropertyType;
  /** Every object type, parents before children, each one once. */
  readonly declarations: readonly ObjectDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}
