import { isHttpMethod } from "./types";

/** Reject malformed request methods before import can drop or normalize them. */
export function validateImportedMethods(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(validateImportedMethods); return; }
  const object = value as Record<string, unknown>;
  if (typeof object.url === "string" && "method" in object && !isHttpMethod(object.method)) {
    throw new Error("The file contains an unsupported HTTP method. Import was cancelled.");
  }
  Object.values(object).forEach(validateImportedMethods);
}
