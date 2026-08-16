export const materialFileAccept =
  ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff";

export const maxMaterialFileBytes = 25 * 1024 * 1024;

const acceptedExtensions = new Set(materialFileAccept.split(","));

export type MaterialFileIssue = "unsupported" | "empty" | "too-large";

export function validateMaterialFile(file: File): MaterialFileIssue | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!acceptedExtensions.has(extension)) return "unsupported";
  if (file.size === 0) return "empty";
  if (file.size > maxMaterialFileBytes) return "too-large";
  return null;
}
