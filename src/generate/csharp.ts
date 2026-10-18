/**
 * C# from the inferred model: one record or class per object type, with System.Text.Json or
 * Newtonsoft.Json attributes where a member's name differs from its JSON name.
 */
import type { Model, ObjectDeclaration, Property, PropertyType, TypeRef } from '../infer';

export interface CSharpOptions {
  /** `record` gives `{ get; init; }` properties, `class` gives `{ get; set; }`. Default: class. */
  readonly kind?: 'record' | 'class';
  /**
   * Which serializer's attributes to write when a member's name differs from its JSON name. Also
   * picks the type for integers beyond 64 bits: Int128 for System.Text.Json (and none), BigInteger
   * for Newtonsoft, the only one each reads. Default: systemTextJson.
   */
  readonly attributes?: 'systemTextJson' | 'newtonsoft' | 'none';
  /**
   * Nullable reference types: `string?` for strings that may be null or missing, and initialisers
   * on the rest so that none is left null. Default: true.
   */
  readonly nullable?: boolean;
  /** `List<T>` or `T[]`. Default: list. */
  readonly collection?: 'list' | 'array';
  /** A file-scoped namespace; invalid characters become underscores. Default: none. */
  readonly namespace?: string;
}

/** The C# source for a model; the root type's name is the one given to inferModel. */
export function generateCSharp(model: Model, options: CSharpOptions = {}): string {
  return new Writer({
    kind: options.kind ?? 'class',
    attributes: options.attributes ?? 'systemTextJson',
    nullable: options.nullable ?? true,
    collection: options.collection ?? 'list',
    namespace: namespaceName(options.namespace ?? ''),
  }).write(model);
}

type Settings = Required<CSharpOptions>;

class Writer {
  private readonly usings = new Set<string>();

  constructor(private readonly settings: Settings) {}

  write(model: Model): string {
    const body: string[] = [];
    // Only an object root is deserialised as the root type itself; say how to read anything else.
    if (model.root.type.kind !== 'object') {
      // Only a comment: whatever usings the type would need, the code doesn't.
      const usings = [...this.usings];
      const type = this.type(model.root);
      this.usings.clear();
      for (const using of usings) this.usings.add(using);
      body.push(
        model.declarations.length > 0
          ? `// Deserialise the JSON as ${type}.`
          : `// The JSON holds no objects: deserialise it as ${type}.`,
      );
    }
    for (const declaration of model.declarations) body.push(this.declaration(declaration));
    // Nothing to declare, so nothing for usings or a namespace to apply to.
    if (model.declarations.length === 0) return body.join('\n\n') + '\n';

    const header: string[] = [];
    if (this.settings.nullable) header.push('#nullable enable');
    if (this.usings.size > 0) {
      // System first, then alphabetical: the order dotnet format and Visual Studio sort into.
      const usings = [...this.usings].sort((a, b) =>
        a.startsWith('System') !== b.startsWith('System')
          ? a.startsWith('System')
            ? -1
            : 1
          : a < b
            ? -1
            : 1,
      );
      header.push(usings.map((u) => `using ${u};`).join('\n'));
    }
    if (this.settings.namespace !== '') header.push(`namespace ${this.settings.namespace};`);
    return [...header, ...body].join('\n\n') + '\n';
  }

  private declaration(declaration: ObjectDeclaration): string {
    const lines = [`public ${this.settings.kind} ${declaration.name}`, '{'];
    for (const property of declaration.properties) lines.push(...this.property(property));
    lines.push('}');
    return lines.join('\n');
  }

  private property(property: Property): string[] {
    const lines: string[] = [];
    if (property.name !== property.jsonName) {
      if (this.settings.attributes === 'systemTextJson') {
        this.usings.add('System.Text.Json.Serialization');
        lines.push(`    [JsonPropertyName(${stringLiteral(property.jsonName)})]`);
      } else if (this.settings.attributes === 'newtonsoft') {
        this.usings.add('Newtonsoft.Json');
        lines.push(`    [JsonProperty(${stringLiteral(property.jsonName)})]`);
      }
    }
    // A property missing from some objects reads as null there, like one that was null.
    const type = { type: property.type, nullable: property.nullable || property.optional };
    const accessors = this.settings.kind === 'record' ? '{ get; init; }' : '{ get; set; }';
    lines.push(`    public ${this.type(type)} ${property.name} ${accessors}${this.initialiser(type)}`);
    return lines;
  }

  /** With nullable reference types, a reference that is never null starts out as an empty value. */
  private initialiser({ type, nullable }: PropertyType): string {
    if (!this.settings.nullable || nullable) return '';
    switch (type.kind) {
      case 'string':
        return ' = "";';
      case 'array':
        return ' = [];';
      case 'object':
        return ' = new();';
      default:
        return '';
    }
  }

  private type({ type, nullable }: PropertyType): string {
    const name = this.typeName(type);
    // Anything may stand where nothing could be inferred, null included.
    if (type.kind === 'any') return this.settings.nullable ? `${name}?` : name;
    if (!nullable) return name;
    return isValueType(type) || this.settings.nullable ? `${name}?` : name;
  }

  private typeName(type: TypeRef): string {
    switch (type.kind) {
      case 'string':
        return 'string';
      case 'dateTime':
        this.usings.add('System');
        // DateTimeOffset keeps the offset; values without one read as local time.
        return type.offset === 'never' ? 'DateTime' : 'DateTimeOffset';
      case 'date':
        this.usings.add('System');
        return 'DateOnly';
      case 'guid':
        this.usings.add('System');
        return 'Guid';
      case 'integer':
        if (type.bits === 32) return 'int';
        if (type.bits === 64) return 'long';
        if (this.settings.attributes === 'newtonsoft') {
          this.usings.add('System.Numerics');
          return 'BigInteger';
        }
        this.usings.add('System');
        return 'Int128';
      case 'decimal':
        return 'decimal';
      case 'float':
        return 'double';
      case 'boolean':
        return 'bool';
      case 'any':
        return 'object';
      case 'array': {
        const items = this.type(type.items);
        if (this.settings.collection === 'array') return arrayOf(items);
        this.usings.add('System.Collections.Generic');
        return `List<${items}>`;
      }
      case 'object':
        return type.name;
    }
  }
}

function isValueType(type: TypeRef): boolean {
  return !['string', 'any', 'array', 'object'].includes(type.kind);
}

/**
 * An array of the given element type: the element's own brackets and annotations stay as they are
 * and the new rank goes after them. An array of `int[]?` is `int[]?[]`, which C# reads as a
 * non-null array of nullable `int[]`.
 */
function arrayOf(element: string): string {
  return `${element}[]`;
}

/** C#'s reserved keywords: an identifier spelled like one needs an @. */
const KEYWORDS = new Set(
  (
    'abstract as base bool break byte case catch char checked class const continue decimal default ' +
    'delegate do double else enum event explicit extern false finally fixed float for foreach goto if ' +
    'implicit in int interface internal is lock long namespace new null object operator out override ' +
    'params private protected public readonly ref return sbyte sealed short sizeof stackalloc static ' +
    'string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual ' +
    'void volatile while global'
  ).split(' '),
);

/**
 * A namespace from what the user typed: dotted segments, each made a valid identifier (invalid
 * characters become underscores, a leading digit gets one, a keyword gets an @). Empty if nothing
 * is left.
 */
export function namespaceName(input: string): string {
  return input
    .normalize('NFC')
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .map((segment) => {
      // Letters outside the Basic Multilingual Plane included: C# rejects them in identifiers.
      const name = Array.from(segment, (c) =>
        /^[\p{L}\p{Mn}\p{Mc}\p{Nd}\p{Nl}\p{Pc}]$/u.test(c) && c.length === 1 ? c : '_',
      ).join('');
      if (!/^[\p{L}\p{Nl}_]/u.test(name)) return `_${name}`;
      return KEYWORDS.has(name) ? `@${name}` : name;
    })
    .join('.');
}

/**
 * A C# string literal. Escapes what would end or break the literal, invisible and format
 * characters (which could make the source read differently from what it does), and lone
 * surrogates; C# also ends lines at U+0085, U+2028 and U+2029.
 */
export function stringLiteral(value: string): string {
  const escaped = value.replace(
    /["\\]|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
    (c) =>
      c === '"' || c === '\\'
        ? `\\${c}`
        : `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  );
  return `"${escaped}"`;
}
