import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes } from "react";
import { useExitTransition } from "./useExitTransition";

/** A div that fades out when it unmounts (see useExitTransition). For popovers and menus rendered inline as `{open && ...}`. */
export const ExitDiv = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ExitDiv(props, ref) {
  const inner = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLDivElement);
  useExitTransition(inner);
  return <div ref={inner} data-state="open" {...props} />;
});
