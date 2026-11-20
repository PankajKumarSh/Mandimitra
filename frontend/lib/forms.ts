import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import { apiError } from '@/services/base-query';

/**
 * HTML inputs give '' for empty. For create, drop empty fields; for update (PATCH), send null
 * so a cleared field is actually cleared. Applied before the shared Zod schema validates.
 */
export function cleanPayload<T extends Record<string, unknown>>(values: T, mode: 'create' | 'update'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const val = typeof v === 'string' ? v.trim() : v;
    if (val === '' || val === undefined) {
      if (mode === 'update') out[k] = null;
      continue;
    }
    out[k] = val;
  }
  return out;
}

/** Shared schema wrapped so the form validates exactly what will be sent. */
export function formSchema<S extends z.ZodType>(schema: S, mode: 'create' | 'update') {
  // preprocess() types its input as `unknown`; form values are always a plain object.
  return z.preprocess((v) => cleanPayload((v ?? {}) as Record<string, unknown>, mode), schema) as unknown as z.ZodType<
    z.output<S>,
    Record<string, unknown>
  >;
}

/** Map API VALIDATION_ERROR details onto form fields; returns the top-level message otherwise. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): string {
  const e = apiError(err);
  if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) {
    let mapped = false;
    for (const d of e.details as { path: string; message: string }[]) {
      const top = d.path.split('.')[0]!;
      if (fields.includes(top)) {
        setError(top as Path<T>, { type: 'server', message: d.message });
        mapped = true;
      }
    }
    if (mapped) return '';
  }
  return e.message;
}
