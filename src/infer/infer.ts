import type { Diagnostic, Model, ObjectDeclaration, Property, PropertyType, TypeRef } from './model';
import { singular, typeName } from './names';
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
  const diagnostics: Diagnostic[] = [];
  addSample(shape, json, '$', diagnostics);
  const resolver = new Resolver(diagnostics);
  const rootName = typeName(options.rootName ?? 'Root');
  const root = resolver.resolve(shape, '$', rootName, rootName);
  return { root, declarations: resolver.declarationsFrom(root.type), diagnostics };
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
  dateTime: boolean;
  date: boolean;
  guid: boolean;
}

interface NumberShape {
  decimal: boolean;
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
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;
const GUID = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

function isRealDate(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

function isDate(value: string): boolean {
  const match = DATE.exec(value);
  return match !== null && isRealDate(match[1] ?? '', match[2] ?? '', match[3] ?? '');
}

function isDateTime(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (!match || !isRealDate(match[1] ?? '', match[2] ?? '', match[3] ?? '')) return false;
  return Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6] ?? 0) < 60;
}

const INT32 = 2n ** 31n;
const INT64 = 2n ** 63n;

function numberShape(raw: string): NumberShape {
  if (/[.eE]/.test(raw)) return { decimal: true, bits: 32 };
  const value = BigInt(raw);
  if (value >= -INT32 && value < INT32) return { decimal: false, bits: 32 };
  if (value >= -INT64 && value < INT64) return { decimal: false, bits: 64 };
  return { decimal: false, bits: 'big' };
}

const widerBits = (a: NumberShape['bits'], b: NumberShape['bits']): NumberShape['bits'] =>
  a === 'big' || b === 'big' ? 'big' : a === 64 || b === 64 ? 64 : 32;

function addSample(shape: Shape, value: JsonValue, path: string, diagnostics: Diagnostic[]): void {
  shape.count++;
  switch (value.type) {
    case 'null':
      shape.nulls++;
      return;
    case 'boolean':
      shape.booleans++;
      return;
    case 'string': {
      const strings = (shape.strings ??= { dateTime: true, date: true, guid: true });
      strings.dateTime &&= isDateTime(value.value);
      strings.date &&= isDate(value.value);
      strings.guid &&= GUID.test(value.value);
      return;
    }
    case 'number': {
      const seen = numberShape(value.raw);
      shape.numbers = shape.numbers
        ? { decimal: shape.numbers.decimal || seen.decimal, bits: widerBits(shape.numbers.bits, seen.bits) }
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
          diagnostics.push({
            path: propertyPath(path, key),
            severity: 'warning',
            message: `The key "${key}" appears more than once in the same object; the last value is used.`,
          });
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

// Phase 2: shapes into types, with object types named and identical ones shared.

class Resolver {
  private readonly declarations = new Map<string, ObjectDeclaration>();
  /** Declaration name by structure, so identical objects share one type. */
  private readonly byStructure = new Map<string, string>();

  constructor(private readonly diagnostics: Diagnostic[]) {}

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
      if (shape.count > 0) {
        this.note(path, 'info', 'Only null values here, so the type is unknown.');
      }
      return { type: { kind: 'any' }, nullable };
    }
    if (kinds.length > 1) {
      this.note(
        path,
        'warning',
        `Values of different kinds here (${kinds.join(', ')}), so the type is unknown.`,
      );
      return { type: { kind: 'any' }, nullable };
    }

    if (shape.strings) {
      const { dateTime, date, guid } = shape.strings;
      const kind = dateTime ? 'dateTime' : date ? 'date' : guid ? 'guid' : 'string';
      return { type: { kind }, nullable };
    }
    if (shape.numbers) {
      const { decimal, bits } = shape.numbers;
      return { type: decimal ? { kind: 'decimal' } : { kind: 'integer', bits }, nullable };
    }
    if (shape.object) return { type: this.declare(shape.object, path, nameHint), nullable };
    if (shape.array) {
      if (!shape.array.items) {
        this.note(path, 'info', 'Only empty arrays here, so the item type is unknown.');
        return { type: { kind: 'array', items: { kind: 'any' } }, nullable };
      }
      const items = this.resolve(shape.array.items, `${path}[*]`, itemHint, itemHint);
      if (items.nullable) {
        this.note(`${path}[*]`, 'info', 'Some items are null; the item type is used as is.');
      }
      return { type: { kind: 'array', items: items.type }, nullable };
    }
    return { type: { kind: 'boolean' }, nullable };
  }

  private declare(object: ObjectShape, path: string, nameHint: string): TypeRef {
    const properties: Property[] = [];
    for (const [key, field] of object.fields) {
      const hint = typeName(key);
      const type = this.resolve(field, propertyPath(path, key), hint, singular(hint));
      properties.push({ jsonName: key, ...type, optional: field.count < object.count });
    }

    const structure = JSON.stringify(properties);
    const existing = this.byStructure.get(structure);
    if (existing) return { kind: 'object', name: existing };

    const name = this.uniqueName(nameHint);
    this.declarations.set(name, { name, properties });
    this.byStructure.set(structure, name);
    return { kind: 'object', name };
  }

  private uniqueName(hint: string): string {
    if (!this.declarations.has(hint)) return hint;
    for (let n = 2; ; n++) {
      const name = `${hint}${String(n)}`;
      if (!this.declarations.has(name)) return name;
    }
  }

  private note(path: string, severity: Diagnostic['severity'], message: string): void {
    this.diagnostics.push({ path, severity, message });
  }

  /** The declarations reachable from the root, parents before children. */
  declarationsFrom(root: TypeRef): ObjectDeclaration[] {
    const ordered: ObjectDeclaration[] = [];
    const visit = (type: TypeRef): void => {
      if (type.kind === 'array') {
        visit(type.items);
        return;
      }
      if (type.kind !== 'object' || ordered.some((d) => d.name === type.name)) return;
      const declaration = this.declarations.get(type.name);
      if (!declaration) return;
      ordered.push(declaration);
      for (const property of declaration.properties) visit(property.type);
    };
    visit(root);
    return ordered;
  }
}
