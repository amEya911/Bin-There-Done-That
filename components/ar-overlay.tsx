"use client";
import { useId } from "react";
import { layoutCallouts, guidanceLabel, type Rect } from "@/lib/ar";
import type { Detection, Guidance } from "@/lib/types";

export default function AROverlay({
  detection,
  guidance,
  frame,
}: {
  detection: Detection;
  guidance: Guidance[];
  frame: Rect;
}) {
  const markerId = useId().replace(/:/g, "");
  if (!frame.width || !frame.height) return null;
  const callouts = layoutCallouts(guidance, frame.width, frame.height);
  return (
    <div
      className="detection-layer"
      style={frame}
      aria-label="Detected object and component guidance"
    >
      {detection.box && (
        <div
          className={`detection-box ${detection.overflow ? "overflow" : ""}`}
          style={{
            left: `${detection.box.x * 100}%`,
            top: `${detection.box.y * 100}%`,
            width: `${detection.box.width * 100}%`,
            height: `${detection.box.height * 100}%`,
          }}
        >
          {(detection.scene === "bin" || !guidance.length) && (
            <span>
              {detection.overflow ? "Visible overflow" : detection.target}
            </span>
          )}
        </div>
      )}
      <svg
        className="ar-leaders"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffbd89" />
          </marker>
        </defs>
        {callouts.map((c) => {
          const dx = c.anchor.x - c.start.x,
            dy = c.anchor.y - c.start.y;
          const length = Math.hypot(dx, dy) || 1;
          const end = {
            x: c.anchor.x - (dx / length) * 13,
            y: c.anchor.y - (dy / length) * 13,
          };
          return (
            <g key={c.index}>
              <path
                d={`M ${c.start.x} ${c.start.y} L ${end.x} ${end.y}`}
                stroke="#201711"
                strokeWidth="5"
                fill="none"
              />
              <path
                d={`M ${c.start.x} ${c.start.y} L ${end.x} ${end.y}`}
                stroke="#ffbd89"
                strokeWidth="2"
                fill="none"
                markerEnd={`url(#${markerId})`}
              />
              <circle
                cx={c.anchor.x}
                cy={c.anchor.y}
                r="10"
                fill="#ff9b68"
                stroke="#332419"
                strokeWidth="2"
              />
              <text
                x={c.anchor.x}
                y={c.anchor.y + 3.5}
                textAnchor="middle"
                fill="#332419"
                fontSize="10"
                fontWeight="700"
              >
                {c.index + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {callouts.map((c) => (
        <div
          key={c.index}
          className={`ar-callout ${c.item.stream}`}
          style={{ left: c.left, top: c.top, width: c.width, height: c.height }}
        >
          <span>
            {c.index + 1}. {c.item.label}
          </span>
          <strong>{guidanceLabel(c.item)}</strong>
        </div>
      ))}
    </div>
  );
}
