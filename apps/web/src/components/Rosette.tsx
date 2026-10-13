import type { ReactNode } from "react"

/**
 * The figure beside the headline: rings laid over one another around a core, turning slowly.
 * It is drawn here, as vector shapes, so the site ships no images. `id` keeps the gradient
 * names unique when more than one figure is on a page.
 */
export function Rosette({
  id,
  petals = 22,
  reach = 96,
  length = 104,
  width = 44,
  children,
}: {
  id: string
  petals?: number
  /** How far from the centre each ring sits. */
  reach?: number
  length?: number
  width?: number
  children?: ReactNode
}) {
  const turns = Array.from({ length: petals }, (_, index) => (index * 360) / petals)
  return (
    <div className="orb" aria-hidden="true">
      <svg viewBox="-220 -220 440 440">
        <defs>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0" stopColor="#b3fd60" stopOpacity="0.2" />
            <stop offset="0.55" stopColor="#4c7821" stopOpacity="0.1" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e3ffbd" />
            <stop offset="0.4" stopColor="#b3fd60" />
            <stop offset="1" stopColor="#2c4f0f" />
          </linearGradient>
          <radialGradient id={`${id}-body`} cx="0.3" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#b3fd60" stopOpacity="0.2" />
            <stop offset="0.6" stopColor="#4c7821" stopOpacity="0.1" />
            <stop offset="1" stopColor="#0a1600" stopOpacity="0.04" />
          </radialGradient>
          <radialGradient id={`${id}-core`}>
            <stop offset="0" stopColor="#101010" />
            <stop offset="1" stopColor="#000" />
          </radialGradient>
        </defs>
        <circle r="218" fill={`url(#${id}-halo)`} />
        <g className="orb-spin-back">
          {turns
            .filter((_, index) => index % 2 === 0)
            .map((turn) => (
              <ellipse
                key={turn}
                cx={reach * 0.86}
                rx={length * 1.08}
                ry={width * 1.5}
                transform={`rotate(${turn + 9})`}
                fill="none"
                stroke="#3136a3"
                strokeOpacity="0.5"
                strokeWidth="1"
              />
            ))}
        </g>
        <g className="orb-spin">
          {turns.map((turn) => (
            <ellipse
              key={turn}
              cx={reach}
              rx={length}
              ry={width}
              transform={`rotate(${turn})`}
              fill={`url(#${id}-body)`}
              stroke={`url(#${id}-edge)`}
              strokeWidth="1.3"
            />
          ))}
        </g>
        <circle r="50" fill={`url(#${id}-core)`} stroke="#383838" />
        <circle r="62" fill="none" stroke="#b3fd60" strokeOpacity="0.28" strokeDasharray="2 7" />
        <path
          d="M0 -24l19 7.6v14.2C19 9.4 11.2 18 0 21.6-11.2 18-19 9.4-19-2.2V-16.4L0-24zm-8.2 23.4l5.9 5.9L8.6-6.4"
          fill="none"
          stroke="#b3fd60"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </div>
  )
}
