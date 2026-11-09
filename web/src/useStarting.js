import { useEffect, useRef, useState } from "react";

// A text box that starts filled in with a value the lab knows (it can arrive a moment after the page) and that the person can change.
// Once they type or clear it, a late starting value never overwrites what they did.
export default function useStarting(start) {
  const [value, setValue] = useState(start ?? "");
  const touched = useRef(false);
  useEffect(() => { if (start !== undefined && !touched.current) setValue(start); }, [start]);
  const change = (v) => { touched.current = true; setValue(v); };
  return [value, change];
}
