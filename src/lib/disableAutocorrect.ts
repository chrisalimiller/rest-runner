/**
 * Turns off autocorrect, auto-capitalization and spell-check on every text field.
 * macOS (WebKit) otherwise "fixes" variable names, URLs, headers and JSON as you type.
 * Fields are marked when they gain focus, so ones rendered later are covered too.
 */
const NON_TEXT = new Set(["checkbox", "radio", "button", "submit", "range", "color", "file"]);

function mark(el: EventTarget | null) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el instanceof HTMLInputElement && NON_TEXT.has(el.type)) return;
  el.setAttribute("autocorrect", "off");
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("spellcheck", "false");
}

export function installAutocorrectOff() {
  document.addEventListener("focusin", (e) => mark(e.target), true);
  document.querySelectorAll("input, textarea").forEach(mark);
}
