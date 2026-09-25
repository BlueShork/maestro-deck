// Adapted from React Bits (https://www.reactbits.dev/components/tilted-card), TS-TW variant.
// Changes: wraps arbitrary children instead of an image, and drops the cursor
// caption and mobile warning, which a desktop sidebar card has no use for.

import type { SpringOptions } from "motion/react";
import { motion, useReducedMotion, useSpring } from "motion/react";
import { useRef, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface TiltedCardProps {
  children: ReactNode;
  scaleOnHover?: number;
  rotateAmplitude?: number;
  perspective?: number;
  className?: string;
}

const springValues: SpringOptions = {
  damping: 30,
  stiffness: 100,
  mass: 2,
};

export default function TiltedCard({
  children,
  scaleOnHover = 1.1,
  rotateAmplitude = 14,
  perspective = 800,
  className,
}: TiltedCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rotateX = useSpring(0, springValues);
  const rotateY = useSpring(0, springValues);
  const scale = useSpring(1, springValues);

  function handleMouse(e: MouseEvent<HTMLDivElement>) {
    if (!ref.current || reduce) return;
    const rect = ref.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    rotateX.set((offsetY / (rect.height / 2)) * -rotateAmplitude);
    rotateY.set((offsetX / (rect.width / 2)) * rotateAmplitude);
  }

  function handleMouseEnter() {
    if (!reduce) scale.set(scaleOnHover);
  }

  function handleMouseLeave() {
    scale.set(1);
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      style={{ perspective: `${perspective}px` }}
      onMouseMove={handleMouse}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className="relative will-change-transform [transform-style:preserve-3d]"
        style={{ rotateX, rotateY, scale }}
      >
        {children}
      </motion.div>
    </div>
  );
}
