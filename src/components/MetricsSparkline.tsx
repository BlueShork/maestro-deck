// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { memo, useMemo } from "react";

import { cn } from "@/lib/utils";

interface Props {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}

function SparklineImpl({ values, width = 220, height = 28, className }: Props) {
  const { path, min, max } = useMemo(() => {
    const nums = values.filter((v): v is number => v != null);
    if (nums.length === 0) return { path: "", min: 0, max: 0 };
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = max - min || 1;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points: string[] = [];
    values.forEach((v, i) => {
      if (v == null) return;
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return { path: points.join(" "), min, max };
  }, [values, width, height]);

  return (
    <svg
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-label={`sparkline from ${min.toFixed(1)} to ${max.toFixed(1)}`}
      role="img"
    >
      {path && (
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export const MetricsSparkline = memo(SparklineImpl);
