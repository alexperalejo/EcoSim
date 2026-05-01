/**
 * ES-81: Live SIRSVIDE Infection Curve Graph
 *
 * Stacked area chart displaying SIRSVIDE state populations over time.
 * Consumes getStats() output from OrganismLayer each simulation tick.
 * Updates every second via internal polling interval.
 *
 * Usage:
 *   <InfectionCurveChart getStats={() => organismLayer.getStats()} />
 *
 * Props:
 *   getStats  — callback returning current SIRSVIDE population counts
 *   maxPoints — max data points before oldest are dropped (default 300 = 5 min)
 *   paused    — whether the simulation is paused (stops data collection)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { SIRSVIDEState } from '../simulation/disease/organism'

// ── Types ────────────────────────────────────────────────────────────

/** Single time-series data point for the chart */
interface CurveDataPoint {
  time: number
  [SIRSVIDEState.Susceptible]: number
  [SIRSVIDEState.Exposed]:     number
  [SIRSVIDEState.Infected]:    number
  [SIRSVIDEState.Recovered]:   number
  [SIRSVIDEState.Vaccinated]:  number
  [SIRSVIDEState.Immune]:      number
  [SIRSVIDEState.Dead]:        number
}

interface InfectionCurveChartProps {
  /** Callback that returns current SIRSVIDE population counts */
  getStats: () => Record<SIRSVIDEState, number>
  /** Max data points before oldest are dropped (default 300) */
  maxPoints?: number
  /** Stops data collection when true */
  paused?: boolean
}

// ── State color mapping ──────────────────────────────────────────────
// Each SIRSVIDE state gets a distinct, colorblind-accessible color.

const STATE_CONFIG: Record<SIRSVIDEState, { label: string; color: string }> = {
  [SIRSVIDEState.Susceptible]: { label: 'Susceptible', color: '#3b82f6' },
  [SIRSVIDEState.Exposed]:     { label: 'Exposed',     color: '#f59e0b' },
  [SIRSVIDEState.Infected]:    { label: 'Infected',    color: '#ef4444' },
  [SIRSVIDEState.Recovered]:   { label: 'Recovered',   color: '#22c55e' },
  [SIRSVIDEState.Vaccinated]:  { label: 'Vaccinated',  color: '#06b6d4' },
  [SIRSVIDEState.Immune]:      { label: 'Immune',      color: '#a855f7' },
  [SIRSVIDEState.Dead]:        { label: 'Dead',        color: '#6b7280' },
}

// Render order: bottom of stack to top. Dead on bottom, Susceptible on top.
const STACK_ORDER: SIRSVIDEState[] = [
  SIRSVIDEState.Dead,
  SIRSVIDEState.Immune,
  SIRSVIDEState.Vaccinated,
  SIRSVIDEState.Recovered,
  SIRSVIDEState.Exposed,
  SIRSVIDEState.Infected,
  SIRSVIDEState.Susceptible,
]

// ── Custom tooltip ───────────────────────────────────────────────────

interface TooltipPayloadEntry {
  dataKey: string
  value:   number
  color:   string
}

function CurveTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: number
}) {
  if (!active || !payload || !label) return null

  const total = payload.reduce((sum, entry) => sum + entry.value, 0)

  return (
    <div style={{
      background: 'rgba(13, 17, 23, 0.95)',
      border: '1px solid #30363d',
      borderRadius: '6px',
      padding: '10px 14px',
      fontSize: '12px',
      lineHeight: '1.6',
    }}>
      <div style={{ color: '#8b949e', marginBottom: '4px' }}>
        t = {label}s — Total: {total}
      </div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
          <span style={{ color: entry.color }}>
            {STATE_CONFIG[entry.dataKey as SIRSVIDEState]?.label ?? entry.dataKey}
          </span>
          <span style={{ color: '#e6edf3' }}>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────

export default function InfectionCurveChart({
  getStats,
  maxPoints = 300,
  paused = false,
}: InfectionCurveChartProps) {
  const [data, setData] = useState<CurveDataPoint[]>([])
  const tickRef = useRef(0)
  const getStatsRef = useRef(getStats)

  // Keep ref in sync so the interval always calls the latest callback
  useEffect(() => {
    getStatsRef.current = getStats
  }, [getStats])

  // Poll every 1 second
  useEffect(() => {
    if (paused) return

    const interval = setInterval(() => {
      const stats = getStatsRef.current()
      const point: CurveDataPoint = {
        time: tickRef.current,
        [SIRSVIDEState.Susceptible]: stats[SIRSVIDEState.Susceptible],
        [SIRSVIDEState.Exposed]:     stats[SIRSVIDEState.Exposed],
        [SIRSVIDEState.Infected]:    stats[SIRSVIDEState.Infected],
        [SIRSVIDEState.Recovered]:   stats[SIRSVIDEState.Recovered],
        [SIRSVIDEState.Vaccinated]:  stats[SIRSVIDEState.Vaccinated],
        [SIRSVIDEState.Immune]:      stats[SIRSVIDEState.Immune],
        [SIRSVIDEState.Dead]:        stats[SIRSVIDEState.Dead],
      }

      setData(prev => {
        const next = [...prev, point]
        return next.length > maxPoints ? next.slice(next.length - maxPoints) : next
      })

      tickRef.current++
    }, 1000)

    return () => clearInterval(interval)
  }, [paused, maxPoints])

  // Reset handler
  const handleReset = useCallback(() => {
    setData([])
    tickRef.current = 0
  }, [])

  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: '8px',
      padding: '16px',
      width: '100%',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
      }}>
        <div>
          <div style={{ color: '#e6edf3', fontSize: '14px', fontWeight: 600 }}>
            Infection Curve — SIRSVIDE
          </div>
          <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>
            Population by disease state over time
          </div>
        </div>
        <button
          onClick={handleReset}
          style={{
            background: 'transparent',
            border: '1px solid #30363d',
            borderRadius: '4px',
            color: '#8b949e',
            fontSize: '11px',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
          <XAxis
            dataKey="time"
            stroke="#484f58"
            tick={{ fill: '#8b949e', fontSize: 11 }}
            label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -4, fill: '#8b949e', fontSize: 11 }}
          />
          <YAxis
            stroke="#484f58"
            tick={{ fill: '#8b949e', fontSize: 11 }}
            label={{ value: 'Population', angle: -90, position: 'insideLeft', offset: 10, fill: '#8b949e', fontSize: 11 }}
          />
          <Tooltip content={<CurveTooltip />} />
          <Legend
            iconType="square"
            wrapperStyle={{ fontSize: '11px', color: '#8b949e', paddingTop: '8px' }}
          />
          {STACK_ORDER.map((state) => (
            <Area
              key={state}
              type="monotone"
              dataKey={state}
              name={STATE_CONFIG[state].label}
              stackId="sirsvide"
              fill={STATE_CONFIG[state].color}
              fillOpacity={0.6}
              stroke={STATE_CONFIG[state].color}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}