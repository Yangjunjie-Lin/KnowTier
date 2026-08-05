export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

export function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item): item is UnknownRecord => item !== null)
    : [];
}

export function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

export function firstText(
  record: UnknownRecord,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const text = textValue(record[key]);
    if (text) return text;
  }
  return null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function firstNumber(
  record: UnknownRecord,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const number = numberValue(record[key]);
    if (number !== null) return number;
  }
  return null;
}

export function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(textValue)
    .filter((item): item is string => item !== null);
}

export function mergedRecord(value: unknown): UnknownRecord {
  const record = asRecord(value) ?? {};
  const properties = asRecord(record.properties) ?? {};
  return { ...properties, ...record };
}

export function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

export function humanizeUnknown(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, " ");
  if (!normalized) return "未知";
  return normalized
    .toLocaleLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase());
}
