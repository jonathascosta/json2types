/**
 * TypeScript from the inferred model: one interface or type alias per object type, with the
 * JSON's own property names. The output is always a module, so its names never merge with
 * globals of the same name (a script's `interface Image` would add to the DOM's).
 */
import type { Model, ObjectDeclaration, Property, PropertyType, TypeRef } from '../infer';

export interface TypeScriptOptions {
  /** `interface Root { … }` or `type Root = { … };`. Default: interface. */
  readonly declaration?: 'interface' | 'type';
  /** Export every type. Without it, the output ends with `export {};` to stay a module. Default: true. */
  readonly export?: boolean;
  /** Mark properties and arrays `readonly`. Default: false. */
  readonly readonly?: boolean;
}

/** The TypeScript source for a model; the root type's name is the one given to inferModel. */
export function generateTypeScript(model: Model, options: TypeScriptOptions = {}): string {
  return new Writer({
    declaration: options.declaration ?? 'interface',
    export: options.export ?? true,
    readonly: options.readonly ?? false,
  }).write(model);
}

type Settings = Required<TypeScriptOptions>;

/** Above a member whose integers a JavaScript number can't all hold. */
const UNSAFE =
  '/** Integers here go past ±2^53 (Number.MAX_SAFE_INTEGER), so JSON.parse rounds some of them. */';

class Writer {
  /** Set when a type just written holds integers beyond ±2^53. */
  private unsafe = false;

  constructor(private readonly settings: Settings) {}

  write(model: Model): string {
    const body: string[] = [];
    // Only an object root parses as the root type itself; say what anything else is.
    if (model.root.type.kind !== 'object') {
      const type = this.type(model.root);
      const comment =
        model.declarations.length > 0
          ? `// Parse the JSON as ${type}.`
          : `// There are no types to declare: parse the JSON as ${type}.`;
      body.push(this.unsafe ? `${UNSAFE}\n${comment}` : comment);
    }
    for (const declaration of model.declarations) body.push(this.declaration(declaration));
    // Nothing declared, nothing to merge with a global.
    if (model.declarations.length === 0) return body.join('\n\n') + '\n';
    if (!this.settings.export) body.push('export {};');
    return body.join('\n\n') + '\n';
  }

  private declaration(declaration: ObjectDeclaration): string {
    const exported = this.settings.export ? 'export ' : '';
    // `{}` would accept any value but null and undefined; only objects were seen, and empty ones.
    if (declaration.properties.length === 0)
      return `${exported}type ${declaration.name} = Record<string, never>;`;
    const block = `{\n${declaration.properties.flatMap((p) => this.property(p)).join('\n')}\n}`;
    return this.settings.declaration === 'interface'
      ? `${exported}interface ${declaration.name} ${block}`
      : `${exported}type ${declaration.name} = ${block};`;
  }

  private property(property: Property): string[] {
    const type = this.type(property);
    const lines = this.unsafe ? [`  ${UNSAFE}`] : [];
    const readonly = this.settings.readonly ? 'readonly ' : '';
    const optional = property.optional ? '?' : '';
    lines.push(`  ${readonly}${propertyName(property.jsonName)}${optional}: ${type};`);
    return lines;
  }

  /** The TypeScript type; sets `unsafe` if it holds integers beyond ±2^53. */
  private type(type: PropertyType): string {
    this.unsafe = false;
    return this.nullableType(type);
  }

  private nullableType({ type, nullable }: PropertyType): string {
    const name = this.typeName(type);
    // unknown already includes null.
    return nullable && type.kind !== 'any' ? `${name} | null` : name;
  }

  private typeName(type: TypeRef): string {
    switch (type.kind) {
      case 'string':
      case 'dateTime':
      case 'date':
      case 'guid':
        // JSON.parse leaves dates and GUIDs as strings.
        return 'string';
      case 'integer':
        if (type.unsafe) this.unsafe = true;
        return 'number';
      case 'decimal':
      case 'float':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'any':
        return 'unknown';
      case 'array': {
        const items = this.nullableType(type.items);
        // A union or a readonly array needs parentheses before []: (string | null)[].
        const element = items.includes(' | ') || items.startsWith('readonly ') ? `(${items})` : items;
        return `${this.settings.readonly ? 'readonly ' : ''}${element}[]`;
      }
      case 'object':
        return type.name;
    }
  }
}

/** A property name as written in a type: bare if it's an identifier, quoted otherwise. */
export function propertyName(name: string): string {
  // ID_Start then ID_Continue, as ECMAScript identifiers; reserved words are fine as property names.
  if (/^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u.test(name)) return name;
  // JSON.stringify escapes quotes, backslashes, control characters and lone surrogates; escape
  // format characters and line separators too, so the source can't read differently than it is.
  return JSON.stringify(name).replace(
    /[\p{Cf}\p{Zl}\p{Zp}]/gu,
    (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  );
}
