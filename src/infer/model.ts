/**
 * A language-neutral description of the types a JSON sample implies. The generators (C#,
 * TypeScript) read this; none of it knows about any target language.
 */

export type TypeRef =
  | { readonly kind: 'string' }
  /** Strings that were always ISO 8601 date-times, e.g. 2026-10-18T12:00:00Z. */
  | { readonly kind: 'dateTime' }
  /** Strings that were always ISO 8601 dates, e.g. 2026-10-18. */
  | { readonly kind: 'date' }
  /** Strings that were always GUIDs, e.g. 3f2504e0-4f89-11d3-9a0c-0305e82c3301. */
  | { readonly kind: 'guid' }
  /** Whole numbers; `bits` is the smallest signed size that holds every one seen. */
  | { readonly kind: 'integer'; readonly bits: 32 | 64 | 'big' }
  /** Numbers with a fraction or an exponent. */
  | { readonly kind: 'decimal' }
  | { readonly kind: 'boolean' }
  /** Nothing to infer from (only nulls, an empty array) or values of different kinds. */
  | { readonly kind: 'any' }
  | { readonly kind: 'array'; readonly items: TypeRef }
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
  /** Where in the JSON, as a JSONPath: `$`, `$.items[*].tags`. */
  readonly path: string;
  readonly severity: 'warning' | 'info';
  readonly message: string;
}

export interface Model {
  readonly root: PropertyType;
  /** Every object type, parents before children, each one once. */
  readonly declarations: readonly ObjectDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}
