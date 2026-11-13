import { useMemo } from "react";
import { bracketSegments, guessLanguage, type BracketLanguage } from "../lib/rainbowBrackets";
import { useRainbowBrackets } from "./useRainbowBrackets";

interface Props {
  text: string;
  /** Rules for strings and comments. Left out, JSON rules are used when the text starts with { or [, otherwise every bracket counts. */
  language?: BracketLanguage;
}

/** Text with its brackets coloured by nesting depth (plain text when the setting is off). Put it inside a <pre>. */
export function RainbowText({ text, language }: Props) {
  const on = useRainbowBrackets();
  const segments = useMemo(() => (on ? bracketSegments(text, language ?? guessLanguage(text)) : null), [on, text, language]);
  if (!segments || segments.length === 1) return <>{text}</>;
  return (
    <>
      {segments.map((s, i) =>
        s.className ? (
          <span key={i} className={s.className}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
