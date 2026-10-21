import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErrorCodes,
  FRAME_TYPE_REGISTRY_FILE,
  type FrameType,
  type FrameTypeRegistryFile,
} from '@taleart/contract';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';

/** Thrown when a frame names a type that is not in the registry. */
export class UnknownFrameTypeError extends Error {
  readonly code = ErrorCodes.unknownFrameType;

  constructor(readonly type: string) {
    super(`"${type}" is not a registered frame type`);
    this.name = 'UnknownFrameTypeError';
  }
}

/** Thrown when frame settings do not match the frame type's JSON Schema. */
export class InvalidFrameSettingsError extends Error {
  readonly code = ErrorCodes.invalidFrameSettings;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidFrameSettingsError';
  }
}

/** A frame type ready to validate settings: its key, label and JSON Schema. */
export interface FrameTypeDefinition {
  key: string;
  label: string;
  schema: object;
}

// Names the property that failed, so the dashboard can show a useful message.
function describe(error: ErrorObject): string {
  const at = `settings${error.instancePath.replace(/\//g, '.')}`;
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'additionalProperties':
      return `${at} has unknown property "${params['additionalProperty'] as string}"`;
    case 'required':
      return `${at} is missing required property "${params['missingProperty'] as string}"`;
    case 'maximum':
      return `${at} must be at most ${params['limit'] as number}`;
    case 'minimum':
      return `${at} must be at least ${params['limit'] as number}`;
    case 'enum':
      return `${at} must be one of: ${(params['allowedValues'] as unknown[]).join(', ')}`;
    default:
      return `${at} ${error.message ?? 'is invalid'}`;
  }
}

/** One top-level property of a settings schema: its own validator and its `default`. */
interface SettingsField {
  validate: ValidateFunction;
  default: unknown;
}

// Each top-level property of a settings schema, compiled on its own so a
// stored value can be checked field by field.
function schemaFields(ajv: Ajv2020, schema: object): Map<string, SettingsField> {
  const fields = new Map<string, SettingsField>();
  const properties = (schema as { properties?: unknown }).properties;
  if (typeof properties !== 'object' || properties === null) return fields;
  for (const [name, property] of Object.entries(properties as Record<string, unknown>)) {
    if (typeof property !== 'object' || property === null) continue;
    fields.set(name, { validate: ajv.compile(property), default: (property as { default?: unknown }).default });
  }
  return fields;
}

interface RegisteredType {
  label: string;
  schema: object;
  fields: Map<string, SettingsField>;
  validate: ValidateFunction;
}

/**
 * The frame types the API accepts (AD-5). Built from configuration, so adding
 * a type means adding a registry entry and a schema, never code.
 */
export class FrameTypeRegistry {
  private readonly types = new Map<string, RegisteredType>();

  constructor(definitions: readonly FrameTypeDefinition[]) {
    const ajv = new Ajv2020({ allErrors: false });
    for (const { key, label, schema } of definitions) {
      if (this.types.has(key)) {
        throw new Error(`Frame type "${key}" is registered twice`);
      }
      // Compiling here makes a broken schema fail at start, not on a write.
      this.types.set(key, { label, schema, fields: schemaFields(ajv, schema), validate: ajv.compile(schema) });
    }
  }

  /** Every registered type with its settings schema, in registry order. */
  list(): FrameType[] {
    return [...this.types].map(([key, { label, schema }]) => ({ key, label, schema: schema as FrameType['schema'] }));
  }

  /**
   * The settings to deliver: only the type's top-level fields whose stored
   * value is valid against that field's schema, then each missing field's
   * schema `default`. Stored settings are validated on write, but rows written
   * before a schema changed (or by hand) must not reach SDKs as they are.
   * Settings that are not an object read as `{}`; an unknown type's object
   * settings come back as they are (clients skip unknown types, AD-5).
   */
  withDefaults(type: string, settings: unknown): Record<string, unknown> {
    const stored =
      typeof settings === 'object' && settings !== null && !Array.isArray(settings)
        ? (settings as Record<string, unknown>)
        : {};
    const entry = this.types.get(type);
    if (!entry) return stored;
    const result: Record<string, unknown> = {};
    for (const [name, field] of entry.fields) {
      if (Object.prototype.hasOwnProperty.call(stored, name) && field.validate(stored[name])) result[name] = stored[name];
      else if (field.default !== undefined) result[name] = field.default;
    }
    return result;
  }

  /** Throws unless `type` is registered and `settings` matches its schema. */
  validate(type: string, settings: unknown): void {
    const entry = this.types.get(type);
    if (!entry) throw new UnknownFrameTypeError(type);
    if (!entry.validate(settings)) {
      const errors = entry.validate.errors ?? [];
      throw new InvalidFrameSettingsError(errors.length ? describe(errors[0]) : 'settings are invalid');
    }
  }
}

function isRegistryFile(value: unknown): value is FrameTypeRegistryFile {
  const types = (value as { types?: unknown } | null)?.types;
  return (
    Array.isArray(types) &&
    types.every(
      (t) =>
        typeof t?.key === 'string' && t.key !== '' && typeof t.label === 'string' && typeof t.schema === 'string',
    )
  );
}

/**
 * Reads the registry from a directory holding `registry.json` and the schema
 * files it names (the contract's `frame-types/` folder, or a copy of it).
 */
export function loadFrameTypeRegistry(dir: string): FrameTypeRegistry {
  const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const file = readJson(FRAME_TYPE_REGISTRY_FILE);
  if (!isRegistryFile(file)) {
    throw new Error(`${join(dir, FRAME_TYPE_REGISTRY_FILE)} must list types with key, label and schema`);
  }
  return new FrameTypeRegistry(
    file.types.map(({ key, label, schema }) => ({ key, label, schema: readJson(schema) as object })),
  );
}
