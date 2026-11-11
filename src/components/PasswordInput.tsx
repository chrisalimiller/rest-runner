import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./shell/Icons";

/** A password field with a show/hide button. Hidden by default; the choice is not saved. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-input">
      <input {...props} type={shown ? "text" : "password"} spellCheck={false} />
      <button
        type="button"
        className="icon-btn password-toggle"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label="Show password"
        title={shown ? "Hide password" : "Show password"}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
