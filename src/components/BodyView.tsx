import { prettyBody } from "../lib/format";
import { CodeEditor } from "./CodeEditor";

interface Props {
  body: string;
  /** Pretty-print and highlight when the body is JSON. */
  pretty?: boolean;
  lineNumbers?: boolean;
}

/** Shows a request or response body: highlighted JSON when it is JSON, plain monospace text otherwise. */
export function BodyView({ body, pretty = true, lineNumbers = false }: Props) {
  if (body === "") {
    return (
      <pre className="code-view">
        <span className="muted">(empty body)</span>
      </pre>
    );
  }
  const p = prettyBody(body);
  if (pretty && p.isJson) {
    return (
      <div className="code-view-frame">
        <CodeEditor value={p.text} json readOnly lineNumbers={lineNumbers} ariaLabel="Body" />
      </div>
    );
  }
  return <pre className="code-view">{body}</pre>;
}
