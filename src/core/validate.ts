import { GeometryError } from './geometry';

export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new GeometryError(`${name} must be a finite number, got ${String(value)}`);
}

export function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new GeometryError(`${name} must be > 0, got ${String(value)}`);
}

/**
 * Invalid user-facing parameter (e.g. an edge too short for its joint). `param` names the schema
 * key at fault so the UI can show the message at that field.
 */
export class ParamError extends Error {
  readonly param: string | undefined;
  constructor(message: string, param?: string) {
    super(message);
    this.name = 'ParamError';
    this.param = param;
  }
}
