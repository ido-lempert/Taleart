// Zone data a page brings itself, with no backend: the body of `GET /delivery/v1/zone`, given as an object or as
// JSON text through `el.data` or `Taleart.setZoneData`. This file reads it into the zone the renderers take (after
// the checks of validate-zone.ts) and keeps the data registered by zone name. Types only from the contract (AD-3).
import type { DeliveryZone } from '@taleart/contract';
import { problemsOf } from './validate-zone';

/**
 * The zone the renderers take, from zone data: a copy of it (the caller's object is never changed or kept) with
 * the optional fields filled in. Throws an Error naming the problems when the data is not valid.
 */
export function readLocalZone(input: unknown): DeliveryZone {
  const { value, errors } = problemsOf(input);
  if (errors.length > 0) throw new Error(`The zone data is not valid. ${errors.join('; ')}`);
  const zone = JSON.parse(JSON.stringify(value)) as DeliveryZone;
  for (const group of zone.taleGroups) {
    group.tags ??= [];
    group.tagMatch ??= 'any';
    group.audience ??= null;
  }
  return zone;
}

// The data registered by zone name (`setZoneData`): the value as given, checked when an element reads it.
const registered = new Map<string, unknown>();

/** Registers (or, with null, removes) the data of the zone named `name`. */
export function registerZoneData(name: string, data: unknown): void {
  if (data === null || data === undefined) registered.delete(name);
  else registered.set(name, data);
}

/** The data registered for the zone named `name`, or undefined. */
export function registeredZoneData(name: string): unknown {
  return name === '' ? undefined : registered.get(name);
}
