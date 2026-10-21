import {
  EDITOR_ONLY_ELEMENT_FIELDS,
  ErrorCodes,
  hasControlCharacter,
  hasTextControlCharacter,
  MAX_TALE_DOCUMENT_BYTES,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_ELEMENT_TYPE_REGISTRY,
  type DeliveryTaleDocument,
  type TaleDocument,
  type TaleDocumentRevision,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import { TaleNotFoundError } from './tales';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when a tale document breaks its schema or a rule of AD-15; `pointer` names the field. */
export class InvalidTaleDocumentError extends Error {
  readonly code = ErrorCodes.invalidTaleDocument;

  constructor(
    readonly pointer: string,
    message: string,
  ) {
    super(`${pointer || 'The document'} ${message}`);
    this.name = 'InvalidTaleDocumentError';
  }
}

/** Thrown when a tale document is larger than {@link MAX_TALE_DOCUMENT_BYTES}. */
export class TaleDocumentTooLargeError extends Error {
  readonly code = ErrorCodes.taleDocumentTooLarge;

  constructor() {
    super(`A tale document holds at most ${MAX_TALE_DOCUMENT_BYTES / 1024} KB`);
    this.name = 'TaleDocumentTooLargeError';
  }
}

/** Thrown when a document write was based on a revision other than the tale's current one. */
export class StaleRevisionError extends Error {
  readonly code = ErrorCodes.staleRevision;

  constructor(readonly currentRevision: number) {
    super('The tale was saved by someone else since you opened it. Reload it to see the latest version.');
    this.name = 'StaleRevisionError';
  }
}

// What one refusal says about the field at `pointer`.
function describe(error: ErrorObject, prefix: string): InvalidTaleDocumentError {
  const params = error.params as Record<string, unknown>;
  const at = `${prefix}${error.instancePath}`;
  switch (error.keyword) {
    case 'additionalProperties':
      return new InvalidTaleDocumentError(`${at}/${params['additionalProperty'] as string}`, 'is not a known property');
    case 'required':
      return new InvalidTaleDocumentError(`${at}/${params['missingProperty'] as string}`, 'is required');
    case 'maxItems':
      return new InvalidTaleDocumentError(at, `holds at most ${params['limit'] as number} items`);
    case 'maxLength':
      return new InvalidTaleDocumentError(at, `holds at most ${params['limit'] as number} characters`);
    case 'const':
      return new InvalidTaleDocumentError(at, `must be ${JSON.stringify(params['allowedValue'])}`);
    default:
      return new InvalidTaleDocumentError(at, error.message ?? 'is invalid');
  }
}

// A rule a registered type adds to its schema, given the element's props and their pointer.
type PropsRule = (props: Record<string, unknown>, pointer: string) => void;

const PROPS_RULES: Readonly<Record<string, PropsRule>> = {
  text: (props, pointer) => {
    if (typeof props['text'] === 'string' && hasTextControlCharacter(props['text'])) {
      throw new InvalidTaleDocumentError(`${pointer}/text`, 'may not hold control characters other than a line feed');
    }
  },
};

interface Validators {
  document: ValidateFunction;
  props: Map<string, ValidateFunction>;
}

let validators: Validators | null = null;

// The schemas are compiled once, on first use.
function compiled(): Validators {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: false });
  const props = new Map<string, ValidateFunction>();
  for (const { key, schema } of TALE_ELEMENT_TYPE_REGISTRY) props.set(key, ajv.compile(schema));
  validators = { document: ajv.compile(TALE_DOCUMENT_V1_SCHEMA), props };
  return validators;
}

// Refuses a number that is not finite anywhere in the value (JSON's 1e999 parses as Infinity).
function checkFinite(value: unknown, pointer: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidTaleDocumentError(pointer, 'must be a finite number');
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => checkFinite(item, `${pointer}/${i}`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      checkFinite(item, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  }
}

/**
 * Checks a tale document on write (AD-15) and returns it typed: its size, then the envelope
 * schema (no additional properties), then each element's props against its registered type's
 * schema, then the semantic rules: unique ids, finite numbers, no control characters in text
 * (other than a line feed) or labels. Throws {@link TaleDocumentTooLargeError} or
 * {@link InvalidTaleDocumentError}, which names the JSON pointer it refused.
 */
export function checkTaleDocument(value: unknown): TaleDocument {
  const json = JSON.stringify(value) ?? '';
  if (Buffer.byteLength(json, 'utf8') > MAX_TALE_DOCUMENT_BYTES) throw new TaleDocumentTooLargeError();
  checkFinite(value, '');
  const { document, props } = compiled();
  if (!document(value)) {
    const [error] = document.errors ?? [];
    throw error ? describe(error, '') : new InvalidTaleDocumentError('', 'is invalid');
  }
  const doc = value as TaleDocument;
  const ids = new Set<string>();
  doc.elements.forEach((element, i) => {
    const at = `/elements/${i}`;
    const validate = props.get(element.type);
    if (!validate)
      throw new InvalidTaleDocumentError(`${at}/type`, `"${element.type}" is not a registered element type`);
    if (!validate(element.props)) {
      const [error] = validate.errors ?? [];
      throw error ? describe(error, `${at}/props`) : new InvalidTaleDocumentError(`${at}/props`, 'is invalid');
    }
    PROPS_RULES[element.type]?.(element.props as unknown as Record<string, unknown>, `${at}/props`);
    const label = element.a11y.label;
    if (label !== undefined && hasControlCharacter(label)) {
      throw new InvalidTaleDocumentError(`${at}/a11y/label`, 'may not hold control characters');
    }
    const id = element.id.toLowerCase();
    if (ids.has(id)) throw new InvalidTaleDocumentError(`${at}/id`, 'is the id of another element');
    ids.add(id);
  });
  return doc;
}

/**
 * The document as the Delivery API returns it (AD-15): hidden elements removed, and the
 * editor-only fields of the rest. A stored document that no longer passes
 * {@link checkTaleDocument} (written before a rule changed, or by hand) is not delivered: the
 * tale then shows its media only. Null for none.
 */
export function deliverableTaleDocument(stored: unknown): DeliveryTaleDocument | null {
  if (stored === null || stored === undefined) return null;
  let doc: TaleDocument;
  try {
    doc = checkTaleDocument(stored);
  } catch {
    return null;
  }
  const { elements, ...rest } = doc;
  return {
    ...rest,
    elements: elements
      .filter((element) => !element.hidden)
      .map((element) => {
        const delivered: Record<string, unknown> = { ...element };
        for (const field of EDITOR_ONLY_ELEMENT_FIELDS) delete delivered[field];
        return delivered as DeliveryTaleDocument['elements'][number];
      }),
  };
}

/** The tale's document and revision; a tale without one reads `{ document: null, revision: 0 }`. Throws {@link TaleNotFoundError}. */
export async function getTaleDocument(db: Db, taleId: string): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rows } = await db.query<{ document: TaleDocument | null; revision: number }>(
    'SELECT document, document_revision AS revision FROM tales WHERE id = $1',
    [taleId],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  return { document: rows[0].document, revision: rows[0].revision };
}

/**
 * Replaces the tale's document when `basedOn` is its current revision, in one conditional
 * update, and returns it with the next revision. Checks the document first
 * ({@link checkTaleDocument}). Throws {@link StaleRevisionError} when another save came first,
 * so no write is lost silently, and {@link TaleNotFoundError}.
 */
export async function saveTaleDocument(
  db: Db,
  taleId: string,
  value: unknown,
  basedOn: number,
): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const document = checkTaleDocument(value);
  const { rows } = await db.query<{ revision: number }>(
    `UPDATE tales SET document = $2::jsonb, document_revision = document_revision + 1
     WHERE id = $1 AND document_revision = $3
     RETURNING document_revision AS revision`,
    [taleId, JSON.stringify(document), basedOn],
  );
  if (rows.length > 0) return { document, revision: rows[0].revision };
  const current = await db.query<{ revision: number }>(
    'SELECT document_revision AS revision FROM tales WHERE id = $1',
    [taleId],
  );
  if (current.rows.length === 0) throw new TaleNotFoundError(taleId);
  throw new StaleRevisionError(current.rows[0].revision);
}
