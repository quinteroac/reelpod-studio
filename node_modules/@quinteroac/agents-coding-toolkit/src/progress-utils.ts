/**
 * Shared utilities for ID matching and progress entry state updates.
 *
 * Centralises logic used across create-prototype, execute-test-plan, and
 * execute-refactor so that matching rules and timestamp semantics stay
 * consistent.
 */

export function sortedValues(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function idsMatchExactly(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

export function applyStatusUpdate<S extends string>(
  entry: { status: S; updated_at: string },
  status: S,
  timestamp: string,
): void {
  entry.status = status;
  entry.updated_at = timestamp;
}
