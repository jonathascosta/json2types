import type { Diagnostic, Model, ObjectDeclaration, Property, PropertyType, TypeRef } from './model';
import { avoidReserved, pascalCase, singular, typeName } from './names';
import type { JsonValue } from './parse';

export interface InferOptions {
  /** The name of the root type, or of each item when the JSON is an array. Default: Root. */
  readonly rootName?: string;
}

/**
 * Infers the types a JSON sample implies. Every value seen in the same place is merged: the
 * objects of an array become one type, a property missing from some is optional, one that is null
 * in some is nullable, integers and decimals together are decimals.
 */
export function inferModel(json: JsonValue, options: InferOptions = {}): Model {
  const shape = newShape('$');
  const diagnostics = new Diagnostics();
  addSample(shape, json, diagnostics);
  const rootName = typeName(options.rootName ?? 'Root');
  const resolver = new Resolver(diagnostics);
  const root = resolver.resolve(shape, rootName, rootName);
  const { type, declarations } = resolver.name(root.type, rootName);
  return { root: { type, nullable: root.nullable }, declarations, diagnostics: diagnostics.list() };
}

interface Entry {
  path: string;
  severity: Diagnostic['severity'];
  message: string;
  count: number;
}

/**
 * Collects diagnostics, folding repeats at the same place into one with a count. Keyed by the
 * place's shape rather than its path, so a long path is never rebuilt or hashed once per item.
 */
class Diagnostics {
  private readonly entries: Entry[] = [];
  private readonly byPlace = new Map<Shape, Map<string, Entry>>();

  add(place: Shape, severity: Diagnostic['severity'], message: string): void {
    let messages = this.byPlace.get(place);
    if (!messages) {
      messages = new Map();
      this.byPlace.set(place, messages);
    }
    const seen = messages.get(message);
    if (seen) {
      seen.count++;
      return;
    }
    const entry = { path: place.path, severity, message, count: 1 };
    messages.set(message, entry);
    this.entries.push(entry);
  }

  list(): Diagnostic[] {
    return this.entries;
  }
}

// Phase 1: everything seen at each place in the JSON, merged into one shape.

interface Shape {
  /** Where in the JSON, as a JSONPath; built once, when the place is first seen. */
  readonly path: string;
  /** Values seen here, nulls included. */
  count: number;
  nulls: number;
  strings: StringShape | null;
  numbers: NumberShape | null;
  booleans: number;
  object: ObjectShape | null;
  array: ArrayShape | null;
}

interface StringShape {
  /** Every string was a date or a date-time. */
  temporal: boolean;
  /** Every string was a date (no time). */
  date: boolean;
  guid: boolean;
  withOffset: number;
  withoutOffset: number;
}

interface NumberShape {
  decimal: boolean;
  /** Some value is infinite as a double (too large) or reads as 0 though it isn't (too small). */
  infinite: boolean;
  underflows: boolean;
  /** Some value is beyond what an exact decimal holds (±79228162514264337593543950335). */
  beyondDecimal: boolean;
  bits: 32 | 64 | 'big';
}

interface ObjectShape {
  /** Objects merged here. */
  count: number;
  fields: Map<string, Shape>;
}

interface ArrayShape {
  /** Every item of every array seen here; null while all of them were empty. */
  items: Shape | null;
}

function newShape(path: string): Shape {
  return { path, count: 0, nulls: 0, strings: null, numbers: null, booleans: 0, object: null, array: null };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// ISO 8601 as System.Text.Json reads it: a T between date and time, up to 16 fraction digits, and a
// Z or ±hh:mm offset of at most 14 hours.
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,16})?)?(Z|[+-](\d{2}):(\d{2}))?$/;
const GUID = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

function isRealDate(year: string, month: string, day: string): boolean {
  // .NET's dates start at year 1.
  if (Number(year) < 1) return false;
  // setUTCFullYear, unlike Date.UTC, doesn't read years 0 to 99 as 1900 to 1999.
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

/** 'date', 'offset' (a date-time with a zone), 'local' (a date-time without one), or null. */
function temporalKind(value: string): 'date' | 'offset' | 'local' | null {
  const date = DATE.exec(value);
  if (date) return isRealDate(date[1] ?? '', date[2] ?? '', date[3] ?? '') ? 'date' : null;
  const match = DATE_TIME.exec(value);
  if (!match || !isRealDate(match[1] ?? '', match[2] ?? '', match[3] ?? '')) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59) return null;
  if (match[7] === undefined) return 'local';
  if (match[8] !== undefined) {
    const offsetMinutes = Number(match[8]) * 60 + Number(match[9]);
    if (Number(match[9]) > 59 || offsetMinutes > 14 * 60) return null;
    // DateTimeOffset also needs the moment itself, in UTC, within years 1 to 9999.
    const sign = match[7].startsWith('-') ? -1 : 1;
    const utc = new Date(0);
    utc.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    utc.setUTCHours(Number(match[4]), Number(match[5]) - sign * offsetMinutes, Number(match[6] ?? 0));
    if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) return null;
  }
  return 'offset';
}

const INT32 = 2n ** 31n;
const INT64 = 2n ** 63n;
/** The largest magnitude System.Text.Json reads into a C# decimal. */
const DECIMAL_MAX = 79228162514264337593543950335n;

/**
 * Whether a JSON number can't be held by a C# decimal, worked out exactly from its text: beyond
 * DECIMAL_MAX (rounding included), or non-zero but below its smallest step, 1e-28, where it would
 * be rounded to 0 or to 1e-28.
 */
function beyondDecimal(raw: string): boolean {
  const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return false;
  const whole = match[1] ?? '';
  const digits = whole + (match[2] ?? '');
  // Where the decimal point falls in `digits`, once the exponent is applied.
  const point = whole.length + Number(match[3] ?? 0);
  const leadingZeros = /^0*/.exec(digits)?.[0].length ?? 0;
  if (leadingZeros === digits.length) return false; // zero, whatever its exponent
  // The first significant digit is worth 10^(point - leadingZeros - 1).
  const magnitude = point - leadingZeros - 1;
  if (magnitude < -28) return true;
  // More than 29 integer digits can't fit; checking this before any BigInt keeps 1e400000 cheap.
  if (magnitude > 28) return true;
  if (point <= leadingZeros) return false;
  const integerPart = point >= digits.length ? digits.padEnd(point, '0') : digits.slice(0, point);
  const integer = BigInt(integerPart);
  // At the maximum itself, a fraction of .5 or more rounds up past it.
  const roundsUp = /^[5-9]/.test(digits.slice(point));
  return integer > DECIMAL_MAX || (integer === DECIMAL_MAX && roundsUp);
}

function numberShape(raw: string): NumberShape {
  const asDouble = Number(raw);
  const infinite = !Number.isFinite(asDouble);
  const underflows = asDouble === 0 && /[1-9]/.test(raw.replace(/[eE].*$/, ''));
  const integer = (bits: NumberShape['bits'], beyond = false): NumberShape => ({
    decimal: false,
    infinite,
    underflows,
    beyondDecimal: beyond,
    bits,
  });
  if (/[.eE]/.test(raw)) {
    return { decimal: true, infinite, underflows, beyondDecimal: beyondDecimal(raw), bits: 32 };
  }
  // By digit count first, so a million-digit integer doesn't go through BigInt.
  const length = raw.replace(/^-/, '').length;
  if (length <= 9) return integer(32);
  if (length > 29) return integer('big', true);
  const value = BigInt(raw);
  if (value >= -INT32 && value < INT32) return integer(32);
  if (value >= -INT64 && value < INT64) return integer(64);
  return integer('big', value > DECIMAL_MAX || value < -DECIMAL_MAX);
}

const widerBits = (a: NumberShape['bits'], b: NumberShape['bits']): NumberShape['bits'] =>
  a === 'big' || b === 'big' ? 'big' : a === 64 || b === 64 ? 64 : 32;

function addSample(shape: Shape, value: JsonValue, diagnostics: Diagnostics): void {
  shape.count++;
  switch (value.type) {
    case 'null':
      shape.nulls++;
      return;
    case 'boolean':
      shape.booleans++;
      return;
    case 'string': {
      const strings = (shape.strings ??= {
        temporal: true,
        date: true,
        guid: true,
        withOffset: 0,
        withoutOffset: 0,
      });
      const temporal = temporalKind(value.value);
      strings.temporal &&= temporal !== null;
      strings.date &&= temporal === 'date';
      strings.guid &&= GUID.test(value.value);
      if (temporal === 'offset') strings.withOffset++;
      else if (temporal !== null) strings.withoutOffset++;
      return;
    }
    case 'number': {
      const seen = numberShape(value.raw);
      shape.numbers = shape.numbers
        ? {
            decimal: shape.numbers.decimal || seen.decimal,
            infinite: shape.numbers.infinite || seen.infinite,
            underflows: shape.numbers.underflows || seen.underflows,
            beyondDecimal: shape.numbers.beyondDecimal || seen.beyondDecimal,
            bits: widerBits(shape.numbers.bits, seen.bits),
          }
        : seen;
      return;
    }
    case 'array': {
      const array = (shape.array ??= { items: null });
      for (const item of value.items) {
        addSample((array.items ??= newShape(`${shape.path}[*]`)), item, diagnostics);
      }
      return;
    }
    case 'object': {
      const object = (shape.object ??= { count: 0, fields: new Map<string, Shape>() });
      object.count++;
      const fieldFor = (key: string): Shape => {
        let field = object.fields.get(key);
        if (!field) {
          field = newShape(propertyPath(shape.path, key));
          object.fields.set(key, field);
        }
        return field;
      };
      // As in JSON.parse, the last of a repeated key wins.
      const fields = new Map<string, JsonValue>();
      for (const { key, value: fieldValue } of value.entries) {
        if (fields.has(key)) {
          diagnostics.add(
            fieldFor(key),
            'warning',
            `The key ${JSON.stringify(shownKey(key))} appears more than once in the same object; the last value is used.`,
          );
        }
        fields.set(key, fieldValue);
      }
      for (const [key, fieldValue] of fields) addSample(fieldFor(key), fieldValue, diagnostics);
      return;
    }
  }
}

/** A key as shown in paths and messages: long ones are cut short, so deep paths stay readable. */
function shownKey(key: string): string {
  return key.length > 40 ? `${key.slice(0, 40)}…` : key;
}

/** RFC 9535 JSONPath: dot notation for simple names, brackets for the rest. */
function propertyPath(path: string, key: string): string {
  const shown = shownKey(key);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(shown) ? `${path}.${shown}` : `${path}[${JSON.stringify(shown)}]`;
}

function stringType(strings: StringShape): TypeRef {
  if (strings.date) return { kind: 'date' };
  if (strings.temporal) {
    const offset = strings.withoutOffset === 0 ? 'always' : strings.withOffset === 0 ? 'never' : 'mixed';
    return { kind: 'dateTime', offset };
  }
  if (strings.guid) return { kind: 'guid' };
  return { kind: 'string' };
}

// Phase 2: shapes into types. Object types are first collected under placeholder ids, identical
// ones shared; then named from the root down, so the root and outer types get the plain names.

interface Pending {
  readonly hint: string;
  readonly properties: Property[];
}

class Resolver {
  private readonly pending: Pending[] = [];
  /** Placeholder id by name hint and structure, so identical objects in alike places share one type. */
  private readonly byStructure = new Map<string, string>();
  /** Placeholder ids of empty objects, which compare equal when their parents are compared. */
  private readonly empty = new Set<string>();

  constructor(private readonly diagnostics: Diagnostics) {}

  /**
   * @param nameHint What to call an object found here.
   * @param itemHint What to call objects inside an array found here.
   */
  resolve(shape: Shape, nameHint: string, itemHint: string): PropertyType {
    const nullable = shape.nulls > 0;
    const kinds = [
      shape.strings && 'string',
      shape.numbers && 'number',
      shape.booleans > 0 && 'boolean',
      shape.object && 'object',
      shape.array && 'array',
    ].filter((kind): kind is string => typeof kind === 'string');

    if (kinds.length === 0) {
      if (shape.count > 0)
        this.diagnostics.add(shape, 'info', 'Only null values here, so the type is unknown.');
      return { type: { kind: 'any' }, nullable };
    }
    if (kinds.length > 1) {
      this.diagnostics.add(
        shape,
        'warning',
        `Values of different kinds here (${kinds.join(', ')}), so the type is unknown.`,
      );
      return { type: { kind: 'any' }, nullable };
    }

    if (shape.strings) return { type: stringType(shape.strings), nullable };
    if (shape.numbers) {
      const { decimal, beyondDecimal, bits, infinite, underflows } = shape.numbers;
      if (!decimal) return { type: { kind: 'integer', bits }, nullable };
      // Only floating point loses these; integers of any size are kept whole.
      if (beyondDecimal && infinite) {
        this.diagnostics.add(shape, 'warning', 'A number here is too large even for floating point.');
      }
      if (beyondDecimal && underflows) {
        this.diagnostics.add(
          shape,
          'warning',
          'A number here is too small even for floating point; it reads as 0.',
        );
      }
      return { type: { kind: beyondDecimal ? 'float' : 'decimal' }, nullable };
    }
    if (shape.object) return { type: this.collect(shape.object, nameHint), nullable };
    if (shape.array) {
      if (!shape.array.items) {
        this.diagnostics.add(shape, 'info', 'Only empty arrays here, so the item type is unknown.');
        return { type: { kind: 'array', items: { type: { kind: 'any' }, nullable: false } }, nullable };
      }
      const items = this.resolve(shape.array.items, itemHint, itemHint);
      return { type: { kind: 'array', items }, nullable };
    }
    return { type: { kind: 'boolean' }, nullable };
  }

  private collect(object: ObjectShape, nameHint: string): TypeRef {
    const properties: Property[] = [];
    for (const [key, field] of object.fields) {
      const name = pascalCase(key);
      const type = this.resolve(field, avoidReserved(name), avoidReserved(singular(name)));
      // The member name is set once the type itself is named (withMemberNames).
      properties.push({ jsonName: key, name: '', ...type, optional: field.count < object.count });
    }

    // Only objects with the same name hint are shared (billing.address and shipping.address), so a
    // user and a product that both happen to be {"id": …} keep their own types. Property order
    // doesn't matter; the first type found keeps its own. Empty objects aren't shared at all.
    const sorted = [...properties].sort((a, b) => compare(a.jsonName, b.jsonName));
    const structure =
      properties.length === 0 ? null : JSON.stringify([nameHint, sorted.map((p) => this.structureOf(p))]);
    const existing = structure === null ? undefined : this.byStructure.get(structure);
    if (existing) return { kind: 'object', name: existing };

    const id = `#${String(this.pending.length)}`;
    this.pending.push({ hint: nameHint, properties });
    if (structure === null) this.empty.add(id);
    else this.byStructure.set(structure, id);
    return { kind: 'object', name: id };
  }

  /** A property for comparing structures, with every empty object written the same way. */
  private structureOf(property: Property): unknown {
    const erase = (type: TypeRef): unknown => {
      if (type.kind === 'array') return { ...type, items: { ...type.items, type: erase(type.items.type) } };
      if (type.kind === 'object' && this.empty.has(type.name)) return { kind: 'object', name: '{}' };
      return type;
    };
    return { ...property, type: erase(property.type) };
  }

  /** Names the collected types from the root down; returns the root and the declarations. */
  name(root: TypeRef, rootName: string): { type: TypeRef; declarations: ObjectDeclaration[] } {
    const names = new Map<string, string>();
    const used = new Set<string>();
    // The next number to try per hint, so thousands of types wanting one name stay linear.
    const nextNumber = new Map<string, number>();
    const claim = (hint: string): string => {
      let name = hint;
      let n = nextNumber.get(hint) ?? 2;
      // Numbered names skip the built-in ones too: Int → Int2, …, never Int16.
      while (used.has(name) || name !== avoidReserved(name)) name = `${hint}${String(n++)}`;
      nextNumber.set(hint, n);
      used.add(name);
      return name;
    };

    // Breadth first, so every type is named before the types inside it.
    const order: string[] = [];
    const seen = new Set<string>();
    const queue: { id: string; hint: string }[] = [];
    const enqueue = (type: TypeRef, hint?: string): void => {
      if (type.kind === 'array') {
        enqueue(type.items.type, hint);
      } else if (type.kind === 'object' && !seen.has(type.name)) {
        seen.add(type.name);
        queue.push({ id: type.name, hint: hint ?? this.pendingFor(type.name).hint });
      }
    };
    enqueue(root, rootName);
    for (let i = 0; i < queue.length; i++) {
      const next = queue[i];
      if (!next) break;
      const pending = this.pendingFor(next.id);
      names.set(next.id, claim(next.hint));
      order.push(next.id);
      for (const property of pending.properties) enqueue(property.type);
    }

    const rename = (type: TypeRef): TypeRef => {
      if (type.kind === 'array')
        return { kind: 'array', items: { ...type.items, type: rename(type.items.type) } };
      if (type.kind === 'object') return { kind: 'object', name: names.get(type.name) ?? type.name };
      return type;
    };
    const declarations = order.map((id) => {
      const name = names.get(id) ?? id;
      return {
        name,
        properties: withMemberNames(
          name,
          this.pendingFor(id).properties.map((p) => ({ ...p, type: rename(p.type) })),
        ),
      };
    });
    return { type: rename(root), declarations };
  }

  private pendingFor(id: string): Pending {
    const pending = this.pending[Number(id.slice(1))];
    if (!pending) throw new Error(`No type ${id}`);
    return pending;
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Members every C# type inherits, or a record generates; a property named like one would hide it
 * or fail to compile.
 */
const INHERITED_MEMBERS = new Set([
  'Clone',
  'Deconstruct',
  'EqualityContract',
  'Equals',
  'Finalize',
  'GetHashCode',
  'GetType',
  'MemberwiseClone',
  'PrintMembers',
  'ReferenceEquals',
  'ToString',
]);

/**
 * Gives each property a member name: its key in PascalCase; with Value appended when that is the
 * type's own name or an inherited member (ToString → ToStringValue); numbered when two keys meet
 * (a, A → A, A2), skipping names other keys would get by themselves (a, A, a2 → A, A3, A2; and
 * user, userValue in type User → UserValue2, UserValue).
 */
function withMemberNames(typeName: string, properties: readonly Property[]): Property[] {
  const natural = properties.map((property) => pascalCase(property.jsonName));
  const naturalSet = new Set(natural);
  const used = new Set([typeName]);
  // The next number to try per name, so many keys that meet stay linear.
  const nextNumber = new Map<string, number>();
  return properties.map((property, index) => {
    const own = natural[index] ?? 'Item';
    const base = own === typeName || INHERITED_MEMBERS.has(own) ? `${own}Value` : own;
    let name = base;
    // A Value name that another key would get by itself (userValue) is left to that key.
    if (used.has(name) || (base !== own && naturalSet.has(base))) {
      let n = nextNumber.get(base) ?? 2;
      do name = `${base}${String(n++)}`;
      while (used.has(name) || naturalSet.has(name));
      nextNumber.set(base, n);
    }
    used.add(name);
    return { ...property, name };
  });
}
