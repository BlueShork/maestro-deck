// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { motion, type MotionValue, useScroll, useTransform } from "motion/react";
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";

const GAP_PX = 16;

function FlowScrollCell({
  index,
  totalItems,
  itemsPerRow: ITEMS_PER_ROW,
  scrollYProgress,
  children,
}: {
  index: number;
  totalItems: number;
  itemsPerRow: number;
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

/**
 * Grid whose column count follows its own width: as many columns as fit at
 * `minItemWidth`. The count is measured (not left to CSS auto-fill) because
 * the scroll animation needs to know which cells sit on the row edges.
 */
export function FlowScrollGrid({
  children,
  scrollContainerRef,
  minItemWidth = 280,
  className,
}: {
  children: ReactNode[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  minItemWidth?: number;
  className?: string;
}) {
  const { scrollYProgress } = useScroll({
    container: scrollContainerRef,
    offset: ["start start", "end end"],
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const [itemsPerRow, setItemsPerRow] = useState(3);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const cols = Math.floor((el.clientWidth + GAP_PX) / (minItemWidth + GAP_PX));
      setItemsPerRow(Math.max(1, cols));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minItemWidth]);

  const gridProps = {
    ref: gridRef,
    className: className ?? "grid",
    style: { gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`, gap: GAP_PX },
  };

  if (children.length < itemsPerRow * 2) {
    return <div {...gridProps}>{children}</div>;
  }

  return (
    <div {...gridProps}>
      {children.map((child, index) => (
        <FlowScrollCell
          key={index}
          index={index}
          totalItems={children.length}
          itemsPerRow={itemsPerRow}
          scrollYProgress={scrollYProgress}
        >
          {child}
        </FlowScrollCell>
      ))}
    </div>
  );
}
