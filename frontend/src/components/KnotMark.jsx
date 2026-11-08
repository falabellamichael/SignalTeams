import React from "react";

/* Flat 2D SignalTeams knot — the trefoil parametric curve, i.e. the
   plan-view shadow of the 3D torus knot used elsewhere. One continuous
   stroke, self-intersecting at the weave points. Stroked with
   currentColor so CSS (var(--honey) or any palette) tints it per theme. */
const D =
  "M 12.0 9.2 L 12.9 9.2 L 13.7 9.3 L 14.5 9.4 L 15.4 9.6 L 16.1 9.9 L 16.9 10.1 " +
  "L 17.6 10.5 L 18.3 10.8 L 19.0 11.2 L 19.6 11.7 L 20.1 12.2 L 20.6 12.7 " +
  "L 21.1 13.2 L 21.5 13.7 L 21.8 14.3 L 22.0 14.9 L 22.2 15.4 L 22.3 16.0 " +
  "L 22.4 16.5 L 22.4 17.1 L 22.3 17.6 L 22.2 18.1 L 22.0 18.6 L 21.7 19.0 " +
  "L 21.4 19.4 L 21.0 19.8 L 20.6 20.1 L 20.1 20.3 L 19.6 20.5 L 19.0 20.7 " +
  "L 18.4 20.8 L 17.8 20.8 L 17.1 20.8 L 16.5 20.8 L 15.8 20.6 L 15.1 20.4 " +
  "L 14.4 20.1 L 13.7 19.8 L 13.1 19.4 L 12.4 19.0 L 11.8 18.5 L 11.1 18.0 " +
  "L 10.6 17.4 L 10.0 16.8 L 9.5 16.1 L 9.0 15.4 L 8.6 14.7 L 8.2 13.9 " +
  "L 7.8 13.1 L 7.6 12.3 L 7.3 11.5 L 7.2 10.7 L 7.0 9.9 L 7.0 9.1 L 7.0 8.3 " +
  "L 7.0 7.6 L 7.1 6.8 L 7.3 6.1 L 7.5 5.5 L 7.7 4.8 L 8.0 4.3 L 8.3 3.7 " +
  "L 8.7 3.2 L 9.1 2.8 L 9.5 2.4 L 10.0 2.1 L 10.5 1.9 L 11.0 1.7 L 11.5 1.6 " +
  "L 12.0 1.6 L 12.5 1.6 L 13.0 1.7 L 13.5 1.9 L 14.0 2.1 L 14.5 2.4 L 14.9 2.8 " +
  "L 15.3 3.2 L 15.7 3.7 L 16.0 4.3 L 16.3 4.8 L 16.5 5.5 L 16.7 6.1 L 16.9 6.8 " +
  "L 17.0 7.6 L 17.0 8.3 L 17.0 9.1 L 17.0 9.9 L 16.8 10.7 L 16.7 11.5 " +
  "L 16.4 12.3 L 16.2 13.1 L 15.8 13.9 L 15.4 14.7 L 15.0 15.4 L 14.5 16.1 " +
  "L 14.0 16.8 L 13.4 17.4 L 12.9 18.0 L 12.2 18.5 L 11.6 19.0 L 10.9 19.4 " +
  "L 10.3 19.8 L 9.6 20.1 L 8.9 20.4 L 8.2 20.6 L 7.5 20.8 L 6.9 20.8 L 6.2 20.8 " +
  "L 5.6 20.8 L 5.0 20.7 L 4.4 20.5 L 3.9 20.3 L 3.4 20.1 L 3.0 19.8 L 2.6 19.4 " +
  "L 2.3 19.0 L 2.0 18.6 L 1.8 18.1 L 1.7 17.6 L 1.6 17.1 L 1.6 16.5 L 1.7 16.0 " +
  "L 1.8 15.4 L 2.0 14.9 L 2.2 14.3 L 2.5 13.7 L 2.9 13.2 L 3.4 12.7 L 3.9 12.2 " +
  "L 4.4 11.7 L 5.0 11.2 L 5.7 10.8 L 6.4 10.5 L 7.1 10.1 L 7.9 9.9 L 8.6 9.6 " +
  "L 9.5 9.4 L 10.3 9.3 L 11.1 9.2 L 12.0 9.2 Z";

export default function KnotMark({ className = "", style }) {
  return (
    <svg className={`knotmark ${className}`.trim()} viewBox="0 0 24 24"
         style={style} fill="none" aria-hidden="true" focusable="false">
      <path d={D} stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
