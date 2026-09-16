import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "./case-closure-celebration.css";

const colors = ["#2563eb", "#f5b83d", "#ed6b9b", "#8b5cf6", "#2bbda7", "#f18453"];
const pieces = Array.from({ length: 32 }, (_, index) => ({
  distance: 20 + (index * 17 % 43),
  rise: 25 + (index * 13 % 38),
  duration: 2300 + (index * 71 % 600),
  delay: index % 8 * 35,
  width: 5 + index % 4,
  height: index % 3 === 0 ? 6 : 10 + index % 5,
}));

export function CaseClosureCelebration({ onEnd }: { readonly onEnd: (active: boolean) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onEnd(false), 3400);
    return () => window.clearTimeout(timer);
  }, [onEnd]);

  return createPortal(<div className="case-closure-celebration" aria-hidden="true">
    {(["left", "right"] as const).map((side, sideIndex) => pieces.map((piece, index) => (
      <i className="closure-confetti-flight" data-side={side} data-rest={index < 8 || undefined} key={`${side}-${index}`} style={{
        "--confetti-drift": `${piece.distance * (side === "left" ? 1 : -1)}vw`,
        "--confetti-rise": `${-piece.rise}vh`,
        "--confetti-duration": `${piece.duration}ms`,
        "--confetti-delay": `${piece.delay}ms`,
        "--confetti-rest-top": `${25 + index * 7}vh`,
        "--confetti-spin": `${(540 + index * 31) * (side === "left" ? 1 : -1)}deg`,
      } as CSSProperties}>
        <span style={{ background: colors[(index + sideIndex * 2) % colors.length], width: piece.width, height: piece.height, borderRadius: index % 3 === 0 ? "50%" : 1 }} />
      </i>
    )))}
  </div>, document.body);
}
