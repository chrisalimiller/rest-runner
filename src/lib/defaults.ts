import { newId } from "./ids";
import type { KeyValue, RequestDef } from "./types";

export function emptyRow(): KeyValue {
  return { id: newId(), key: "", value: "", enabled: true };
}

export function newRequest(): RequestDef {
  return {
    id: newId(),
    name: "Untitled request",
    method: "GET",
    url: "",
    params: [emptyRow()],
    headers: [emptyRow()],
    bodyMode: "none",
    body: "",
    formBody: [emptyRow()],
    auth: { type: "none" },
  };
}
