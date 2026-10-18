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
  const shape = newShape();
  const diagnostics = new Diagnostics();
  addSample(shape, json, '$', diagnostics);
  const rootName = typeName(options.rootName ?? 'Root');
  const resolver = new Resolver(diagnostics);
  const root = resolver.resolve(shape, '$', rootName, rootName);
  const { type, declarations } = resolver.name(root.type, rootName);
  return { root: { type, nullable: root.nullable }, declarations, diagnostics: diagnostics.list() };
}

/** Collects diagnostics, folding repeats at the same place into one with a count. */
class Diagnostics {
  private readonly byKey = new Map<
    string,
    { path: string; severity: Diagnostic['severity']; message: string; count: number }
  >();

  add(path: string, severity: Diagnostic['severity'], message: string): void {
    const key = `${path}\n${message}`;
    const seen = this.byKey.get(key);
    if (seen) seen.count++;
    else this.byKey.set(key, { path, severity, message, count: 1 });
  }

  list(): Diagnostic[] {
    return [...this.byKey.values()];
  }
}

// Phase 1: everything seen at each place in the JSON, merged into one shape.

interface Shape {
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

function newShape(): Shape {
  return { count: 0, nulls: 0, strings: null, numbers: null, booleans: 0, object: null, array: null };
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
  if (match[8] !== undefined) {
    const offsetMinutes = Number(match[8]) * 60 + Number(match[9]);
    if (Number(match[9]) > 59 || offsetMinutes > 14 * 60) return null;
  }
  return match[7] === undefined ? 'local' : 'offset';
}

const INT32 = 2n ** 31n;
const INT64 = 2n ** 63n;
/** The largest magnitude System.Text.Json reads into a C# decimal. */
const DECIMAL_MAX = 79228162514264337593543950335n;

/** Whether a JSON number's magnitude exceeds DECIMAL_MAX, worked out exactly from its text. */
function beyondDecimal(raw: string): boolean {
  const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return false;
  const whole = match[1] ?? '';
  const digits = whole + (match[2] ?? '');
  // Where the decimal point falls in `digits`, once the exponent is applied.
  const point = whole.length + Number(match[3] ?? 0);
  const leadingZeros = /^0*/.exec(digits)?.[0].length ?? 0;
  // More than 29 integer digits can't fit; checking this first keeps 1e400000 cheap.
  if (point - leadingZeros > 29) return true;
  if (point <= leadingZeros) return false;
  const integerPart = point >= digits.length ? digits.padEnd(point, '0') : digits.slice(0, point);
  return BigInt(integerPart) > DECIMAL_MAX;
}

function numberShape(raw: string): NumberShape {
  if (/[.eE]/.test(raw)) return { decimal: true, beyondDecimal: beyondDecimal(raw), bits: 32 };
  const value = BigInt(raw);
  if (value >= -INT32 && value < INT32) return { decimal: false, beyondDecimal: false, bits: 32 };
  if (value >= -INT64 && value < INT64) return { decimal: false, beyondDecimal: false, bits: 64 };
  return { decimal: false, beyondDecimal: value > DECIMAL_MAX || value < -DECIMAL_MAX, bits: 'big' };
}

const widerBits = (a: NumberShape['bits'], b: NumberShape['bits']): NumberShape['bits'] =>
  a === 'big' || b === 'big' ? 'big' : a === 64 || b === 64 ? 64 : 32;

function addSample(shape: Shape, value: JsonValue, path: string, diagnostics: Diagnostics): void {
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
            beyondDecimal: shape.numbers.beyondDecimal || seen.beyondDecimal,
            bits: widerBits(shape.numbers.bits, seen.bits),
          }
        : seen;
      return;
    }
    case 'array': {
      const array = (shape.array ??= { items: null });
      for (const item of value.items) {
        addSample((array.items ??= newShape()), item, `${path}[*]`, diagnostics);
      }
      return;
    }
    case 'object': {
      const object = (shape.object ??= { count: 0, fields: new Map<string, Shape>() });
      object.count++;
      // As in JSON.parse, the last of a repeated key wins.
      const fields = new Map<string, JsonValue>();
      for (const { key, value: fieldValue } of value.entries) {
        if (fields.has(key)) {
          diagnostics.add(
            propertyPath(path, key),
            'warning',
            `The key "${key}" appears more than once in the same object; the last value is used.`,
          );
        }
        fields.set(key, fieldValue);
      }
      for (const [key, fieldValue] of fields) {
        let field = object.fields.get(key);
        if (!field) {
          field = newShape();
          object.fields.set(key, field);
        }
        addSample(field, fieldValue, propertyPath(path, key), diagnostics);
      }
      return;
    }
  }
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
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
  /** Placeholder id by structure, so identical objects share one type. */
  private readonly byStructure = new Map<string, string>();

  constructor(private readonly diagnostics: Diagnostics) {}

  /**
   * @param nameHint What to call an object found here.
   * @param itemHint What to call objects inside an array found here.
   */
  resolve(shape: Shape, path: string, nameHint: string, itemHint: string): PropertyType {
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
        this.diagnostics.add(path, 'info', 'Only null values here, so the type is unknown.');
      return { type: { kind: 'any' }, nullable };
    }
    if (kinds.length > 1) {
      this.diagnostics.add(
        path,
        'warning',
        `Values of different kinds here (${kinds.join(', ')}), so the type is unknown.`,
      );
      return { type: { kind: 'any' }, nullable };
    }

    if (shape.strings) return { type: stringType(shape.strings), nullable };
    if (shape.numbers) {
      const { decimal, beyondDecimal, bits } = shape.numbers;
      if (!decimal) return { type: { kind: 'integer', bits }, nullable };
      return { type: { kind: beyondDecimal ? 'float' : 'decimal' }, nullable };
    }
    if (shape.object) return { type: this.collect(shape.object, path, nameHint), nullable };
    if (shape.array) {
      if (!shape.array.items) {
        this.diagnostics.add(path, 'info', 'Only empty arrays here, so the item type is unknown.');
        return { type: { kind: 'array', items: { type: { kind: 'any' }, nullable: false } }, nullable };
      }
      const items = this.resolve(shape.array.items, `${path}[*]`, itemHint, itemHint);
      return { type: { kind: 'array', items }, nullable };
    }
    return { type: { kind: 'boolean' }, nullable };
  }

  private collect(object: ObjectShape, path: string, nameHint: string): TypeRef {
    const properties: Property[] = [];
    for (const [key, field] of object.fields) {
      const name = pascalCase(key);
      const type = this.resolve(
        field,
        propertyPath(path, key),
        avoidReserved(name),
        avoidReserved(singular(name)),
      );
      properties.push({ jsonName: key, ...type, optional: field.count < object.count });
    }

    // Empty objects aren't shared: two unrelated {} would otherwise become one oddly named type.
    // Property order doesn't matter for sharing; the first type found keeps its own order.
    const structure =
      properties.length === 0
        ? null
        : JSON.stringify([...properties].sort((a, b) => compare(a.jsonName, b.jsonName)));
    const existing = structure === null ? undefined : this.byStructure.get(structure);
    if (existing) return { kind: 'object', name: existing };

    const id = `#${String(this.pending.length)}`;
    this.pending.push({ hint: nameHint, properties });
    if (structure !== null) this.byStructure.set(structure, id);
    return { kind: 'object', name: id };
  }

  /** Names the collected types from the root down; returns the root and the declarations. */
  name(root: TypeRef, rootName: string): { type: TypeRef; declarations: ObjectDeclaration[] } {
    const names = new Map<string, string>();
    const used = new Set<string>();
    const claim = (hint: string): string => {
      let name = hint;
      for (let n = 2; used.has(name); n++) name = `${hint}${String(n)}`;
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
    for (let next = queue.shift(); next; next = queue.shift()) {
      names.set(next.id, claim(next.hint));
      order.push(next.id);
      for (const property of this.pendingFor(next.id).properties) enqueue(property.type);
    }

    const rename = (type: TypeRef): TypeRef => {
      if (type.kind === 'array')
        return { kind: 'array', items: { ...type.items, type: rename(type.items.type) } };
      if (type.kind === 'object') return { kind: 'object', name: names.get(type.name) ?? type.name };
      return type;
    };
    const declarations = order.map((id) => ({
      name: names.get(id) ?? id,
      properties: this.pendingFor(id).properties.map((p) => ({ ...p, type: rename(p.type) })),
    }));
    return { type: rename(root), declarations };
  }

  private pendingFor(id: string): Pending {
    const pending = this.pending[Number(id.slice(1))];
    if (!pending) throw new Error(`No type ${id}`);
    return pending;
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
