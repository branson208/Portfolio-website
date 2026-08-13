import { createContext, useContext, useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

const CursorContext = createContext({ setLabel: () => {} });

export const useCursor = () => useContext(CursorContext);

export function CursorProvider({ children }) {
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const sx = useSpring(x, { stiffness: 650, damping: 45, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 650, damping: 45, mass: 0.35 });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;
    setEnabled(true);
    const move = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [x, y]);

  return (
    <CursorContext.Provider value={{ setLabel }}>
      {children}
      {enabled && (
        <motion.div
          className="cursor-label"
          style={{ x: sx, y: sy }}
          animate={{ opacity: label ? 1 : 0, scale: label ? 1 : 0.5 }}
          transition={{ duration: 0.18, ease: [0.45, 0, 0.55, 1] }}
          aria-hidden="true"
        >
          <span>{label}</span>
        </motion.div>
      )}
    </CursorContext.Provider>
  );
}
