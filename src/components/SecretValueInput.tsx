import { useState, type InputHTMLAttributes } from "react";
import { SECRET_MASK } from "../lib/secrets";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> {
  value: string;
  /** Whether the real value is showing (the eye is on). */
  shown: boolean;
  secret: boolean;
}

/**
 * A value box for variables. A secret that is hidden shows a fixed-length mask while you are not typing in it,
 * so the dots never reveal how long the value is. Focusing it switches to the real value as a password field.
 */
export function SecretValueInput({ value, shown, secret, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const fixed = secret && !shown && !focused && value !== "";
  return (
    <input
      {...rest}
      type={secret && !shown ? "password" : "text"}
      value={fixed ? SECRET_MASK : value}
      readOnly={fixed ? true : rest.readOnly}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}
