// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { motion, type MotionValue, useScroll, useTransform } from "motion/react";
import { type ReactNode, type RefObject } from "react";

const ITEMS_PER_ROW = 3;

function FlowScrollCell({
  index,
  totalItems,
  scrollYProgress,
  children,
}: {
  index: number;
  totalItems: number;
  scrollYProgress: MotionValue<number>;
  children: ReactNode;
}) {
  const prev = Math.max(0, index - ITEMS_PER_ROW);
  const next = Math.min(totalItems - 1, index + ITEMS_PER_ROW);

  const previousRow = Math.floor(prev / ITEMS_PER_ROW);
  const currentRow = Math.floor(index / ITEMS_PER_ROW);
  const nextRow = Math.floor(next / ITEMS_PER_ROW);
  const totalRows = Math.max(1, Math.floor(totalItems / ITEMS_PER_ROW));
  const scrollRangePerRow = 1 / totalRows;

  const entryAnimation = previousRow / totalRows - scrollRangePerRow;
  const currPosition = currentRow / totalRows;
  const exitAnimation = nextRow / totalRows + scrollRangePerRow * 2;

  const offsetToAdd = (scrollRangePerRow / totalItems) * (currentRow + 2);
  const range = [
    0,
    entryAnimation - offsetToAdd,
    currPosition - offsetToAdd,
    currPosition - offsetToAdd,
    exitAnimation - offsetToAdd,
    1,
  ];

  const scale = useTransform(scrollYProgress, range, [0.5, 0.5, 1, 1, 0.5, 0.5]);
  const isLeft = index % ITEMS_PER_ROW === 0;
  const isRight = index % ITEMS_PER_ROW === ITEMS_PER_ROW - 1;
  const xTransform = useTransform(scrollYProgress, range, [
    isLeft ? "60%" : isRight ? "-60%" : "0%",
    isLeft ? "60%" : isRight ? "-60%" : "0%",
    "0%",
    "0%",
    "0%",
    "0%",
  ]);
  const rotate = useTransform(scrollYProgress, range, [
    isLeft ? -12 : isRight ? 12 : 0,
    isLeft ? -12 : isRight ? 12 : 0,
    0,
    0,
    0,
    0,
  ]);
  const opacity = useTransform(scrollYProgress, range, [0.4, 0.4, 1, 1, 0.4, 0.4]);

  return (
    <motion.div style={{ scale, x: xTransform, rotate, opacity }} className="h-full w-full">
      {children}
    </motion.div>
  );
}

export function FlowScrollGrid({
  children,
  scrollContainerRef,
  className,
}: {
  children: ReactNode[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const { scrollYProgress } = useScroll({
    container: scrollContainerRef,
    offset: ["start start", "end end"],
  });
  const gridClassName = className ? className : "grid grid-cols-3 gap-4 md:gap-6";

  if (children.length < ITEMS_PER_ROW * 2) {
    return <div className={gridClassName}>{children}</div>;
  }

  return (
    <div className={gridClassName}>
      {children.map((child, index) => (
        <FlowScrollCell
          key={index}
          index={index}
          totalItems={children.length}
          scrollYProgress={scrollYProgress}
        >
          {child}
        </FlowScrollCell>
      ))}
    </div>
  );
}
