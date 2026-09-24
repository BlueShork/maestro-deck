// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { motion, type MotionValue, useScroll, useTransform } from "motion/react";
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";

import { toUnitKeyframes } from "./keyframeOffsets";

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
  // Entry / resting / exit points; they can fall outside [0, 1] (the first
  // row's entry happens "before" the scroll starts), so each property is
  // re-sampled onto valid WAAPI keyframe offsets by `toUnitKeyframes`.
  const points = [
    entryAnimation - offsetToAdd,
    currPosition - offsetToAdd,
    currPosition - offsetToAdd,
    exitAnimation - offsetToAdd,
  ];
  const isLeft = index % ITEMS_PER_ROW === 0;
  const isRight = index % ITEMS_PER_ROW === ITEMS_PER_ROW - 1;
  const edgeX = isLeft ? 60 : isRight ? -60 : 0;
  const edgeRotate = isLeft ? -12 : isRight ? 12 : 0;

  const s = toUnitKeyframes(points, [0.5, 1, 1, 0.5]);
  const xk = toUnitKeyframes(points, [edgeX, 0, 0, 0]);
  const rk = toUnitKeyframes(points, [edgeRotate, 0, 0, 0]);
  const ok = toUnitKeyframes(points, [0.4, 1, 1, 0.4]);

  const scale = useTransform(scrollYProgress, s.offsets, s.values);
  const xPercent = useTransform(scrollYProgress, xk.offsets, xk.values);
  const xTransform = useTransform(xPercent, (v) => `${v}%`);
  const rotate = useTransform(scrollYProgress, rk.offsets, rk.values);
  const opacity = useTransform(scrollYProgress, ok.offsets, ok.values);

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
  // The effect is driven by the container's scroll progress. When the grid
  // fits without scrolling, that progress stays 0 forever and every cell
  // would be frozen in its shrunken, faded entry state — render it static.
  const [scrollable, setScrollable] = useState(false);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return;
    const measure = () => setScrollable(container.scrollHeight > container.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [scrollContainerRef]);

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

  if (!scrollable || children.length < itemsPerRow * 2) {
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
