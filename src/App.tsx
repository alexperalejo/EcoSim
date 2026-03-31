/**
 * src/App.tsx
 *
 * ES-37: Live population line charts per species (Recharts)
 * ES-73: Build population graphs with Recharts
 * Also fixes:
 *   - Slider → engine params wiring (was reading _engine which doesn't exist)
 *   - Sim speed slider now actually scales dt via SceneManager.simSpeed
 *   - getAgentStats() now returns real prey/predator counts
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { SceneManager } from './scene/SceneManager'
import { getAgentStats } from './simulation'
import './App.css'

// ── Types ────────────────────────────────────────────────────────────

interface SimStats {
  alive:      number
  prey:       number
  predator:   number
  free:       number
  avgEnergy:  number
  avgAge:     number
  fps:        number
  frame:      number
  generation: number
  dayCount:   number
  timeOfDay:  string
}

interface SimControls {
  mutationRate:     number
  mutationStrength: number
  moveSpeed:        number
  foodEnergyGain:   number
  moveEnergyCost:   number
  foodDetectRadius: number
  simSpeed:         number
}

interface PopSnapshot {
  t:        number   // sim day (x-axis)
  prey:     number
  predator: number
  alive:    number
}

const DEFAULT_CONTROLS: SimControls = {
  mutationRate:     0.05,
  mutationStrength: 0.2,
  moveSpeed:        1.5,
  foodEnergyGain:   20.0,
  moveEnergyCost:   0.1,
  foodDetectRadius: 10.0,
  simSpeed:         1.0,
}

const DAY_DURATION_SECONDS = 240
const POP_HISTORY_MAX      = 120   // keep last 120 samples (~2 min at 1 sample/sec)

// ── Slider ───────────────────────────────────────────────────────────

interface SliderProps {
  label:    string
  value:    number
  min:      number
  max:      number
  step:     number
  unit?:    string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, unit = '', onChange }: SliderProps) {
  return (
    <div className="slider-row">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value.toFixed(step < 0.1 ? 2 : 1)}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="slider-input"
      />
      <div className="slider-range">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

// ── Stat Badge ───────────────────────────────────────────────────────

function StatBadge({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="stat-badge">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

// ── Time helper ───────────────────────────────────────────────────────

function calcDayTime(frameCount: number, fps = 60): { dayCount: number; timeOfDay: string } {
  const totalSeconds = frameCount / fps
  const dayCount     = Math.floor(totalSeconds / DAY_DURATION_SECONDS) + 1
  const timeInDay    = (totalSeconds % DAY_DURATION_SECONDS) / DAY_DURATION_SECONDS

  const totalHours = timeInDay * 24
  const hour       = Math.floor(totalHours)
  const minute     = Math.floor((totalHours - hour) * 60)
  const ampm       = hour >= 12 ? 'PM' : 'AM'
  const hour12     = hour % 12 || 12
  const timeOfDay  = `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`

  return { dayCount, timeOfDay }
}

// ── Custom Recharts tooltip ───────────────────────────────────────────

function PopTooltip({ active, payload, label }: { active?: boolean; payload?: {color:string;name:string;value:number}[]; label?: number }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">Day {label}</div>
      {payload.map(p => (
        <div key={p.name} className="chart-tooltip-row" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────

export default function App() {
  const mountRef    = useRef<HTMLDivElement | null>(null)
  const managerRef  = useRef<SceneManager | null>(null)
  const frameRef    = useRef(0)
  const fpsCountRef = useRef(0)
  const fpsTimerRef = useRef(0)
  const popTimerRef = useRef(0)   // tracks when to take next population sample

  const [running,    setRunning]    = useState(true)
  const [controls,   setControls]   = useState<SimControls>(DEFAULT_CONTROLS)
  const [showCharts, setShowCharts] = useState(false)
  const [popHistory, setPopHistory] = useState<PopSnapshot[]>([])
  const [stats, setStats] = useState<SimStats>({
    alive: 0, prey: 0, predator: 0, free: 0,
    avgEnergy: 0, avgAge: 0, fps: 0, frame: 0, generation: 0,
    dayCount: 1, timeOfDay: '12:00 PM',
  })

  // Mount 3D scene
  useEffect(() => {
    if (!mountRef.current) return
    const manager = new SceneManager(mountRef.current)
    managerRef.current = manager
    manager.start()
    return () => { manager.dispose(); managerRef.current = null }
  }, [])

  // Stats polling + population history sampling
  useEffect(() => {
    let animId: number

    const poll = (now: number) => {
      animId = requestAnimationFrame(poll)
      frameRef.current++
      fpsCountRef.current++

      if (now - fpsTimerRef.current >= 1000) {
        const elapsed = now - fpsTimerRef.current
        const fps     = Math.round(fpsCountRef.current * 1000 / elapsed)
        fpsCountRef.current = 0
        fpsTimerRef.current = now

        const s = getAgentStats()
        const { dayCount, timeOfDay } = calcDayTime(frameRef.current, fps || 60)

        setStats(prev => ({
          ...prev,
          alive:     s.alive,
          prey:      s.prey,
          predator:  s.predator,
          free:      s.free ?? 0,
          avgEnergy: Math.round(s.avgEnergy * 10) / 10,
          avgAge:    Math.round(s.avgAge * 10) / 10,
          fps,
          frame:     frameRef.current,
          dayCount,
          timeOfDay,
        }))

        // ES-37/73: sample population history once per second
        if (now - popTimerRef.current >= 1000) {
          popTimerRef.current = now
          setPopHistory(prev => {
            const next = [...prev, { t: dayCount, prey: s.prey, predator: s.predator, alive: s.alive }]
            return next.length > POP_HISTORY_MAX ? next.slice(-POP_HISTORY_MAX) : next
          })
        }
      }
    }

    fpsTimerRef.current = performance.now()
    popTimerRef.current = performance.now()
    animId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(animId)
  }, [])

  // Pause / Resume
  const handlePauseResume = useCallback(() => {
    const m = managerRef.current
    if (!m) return
    if (running) m.pause?.()
    else m.start()
    setRunning(r => !r)
  }, [running])

  // Reset
  const handleReset = useCallback(() => {
    if (!managerRef.current || !mountRef.current) return
    managerRef.current.dispose()
    const m = new SceneManager(mountRef.current)
    managerRef.current = m
    m.start()
    setRunning(true)
    frameRef.current = 0
    setPopHistory([])
    setStats(prev => ({ ...prev, frame: 0, generation: 0, dayCount: 1, timeOfDay: '12:00 PM' }))
  }, [])

  // Update slider → engine params (fixed: uses SceneManager.params directly)
  const updateControl = useCallback((key: keyof SimControls, value: number) => {
    setControls(prev => {
      const next    = { ...prev, [key]: value }
      const manager = managerRef.current
      if (!manager) return next

      if (key === 'simSpeed') {
        // Wire directly to SceneManager.simSpeed — scales dt each frame
        manager.simSpeed = value
      } else if (manager.params) {
        // Wire to engine SimParams — read directly by GPU shader uniforms next tick
        (manager.params as Record<string, number>)[key] = value
      }
      return next
    })
  }, [])

  return (
    <div className="app-root">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-eco">Eco</span><span className="logo-sim">Sim</span>
          <span className="logo-tag">CSC 583</span>
        </div>

        <section className="sidebar-section">
          <div className="section-label">SIMULATION</div>
          <div className="control-buttons">
            <button
              className={`btn-primary ${running ? 'btn-pause' : 'btn-play'}`}
              onClick={handlePauseResume}
            >
              {running ? '⏸  Pause' : '▶  Resume'}
            </button>
            <button className="btn-secondary" onClick={handleReset}>
              ↺  Reset
            </button>
          </div>
          <div className={`status-pill ${running ? 'pill-running' : 'pill-paused'}`}>
            <span className="status-dot" />
            {running ? 'Running' : 'Paused'}
          </div>
        </section>

        <section className="sidebar-section">
          <div className="section-label">SPEED</div>
          <Slider label="Simulation Speed" value={controls.simSpeed}
            min={0.25} max={4} step={0.25} unit="x"
            onChange={v => updateControl('simSpeed', v)} />
        </section>

        <section className="sidebar-section">
          <div className="section-label">EVOLUTION</div>
          <Slider label="Mutation Rate" value={controls.mutationRate}
            min={0.01} max={0.5} step={0.01}
            onChange={v => updateControl('mutationRate', v)} />
          <Slider label="Mutation Strength" value={controls.mutationStrength}
            min={0.05} max={1.0} step={0.05}
            onChange={v => updateControl('mutationStrength', v)} />
        </section>

        <section className="sidebar-section">
          <div className="section-label">MOVEMENT</div>
          <Slider label="Move Speed" value={controls.moveSpeed}
            min={0.5} max={5} step={0.1}
            onChange={v => updateControl('moveSpeed', v)} />
          <Slider label="Energy Cost" value={controls.moveEnergyCost}
            min={0.05} max={0.5} step={0.05}
            onChange={v => updateControl('moveEnergyCost', v)} />
        </section>

        <section className="sidebar-section">
          <div className="section-label">FOOD</div>
          <Slider label="Energy Gain" value={controls.foodEnergyGain}
            min={5} max={50} step={1}
            onChange={v => updateControl('foodEnergyGain', v)} />
          <Slider label="Detect Radius" value={controls.foodDetectRadius}
            min={2} max={30} step={1}
            onChange={v => updateControl('foodDetectRadius', v)} />
        </section>

        {/* ES-37: charts toggle */}
        <section className="sidebar-section">
          <button
            className={`btn-secondary chart-toggle ${showCharts ? 'chart-toggle-active' : ''}`}
            onClick={() => setShowCharts(s => !s)}
          >
            {showCharts ? '▼ Hide Charts' : '▶ Population Charts'}
          </button>
        </section>

      </aside>

      {/* ── Main area ── */}
      <div className="main-area">
        <div className="viewport-wrapper">
          <div ref={mountRef} className="viewport" />

          {/* Floating HUD top-right */}
          <div className="hud">
            <div className="hud-item">
              <span className="hud-label">FPS</span>
              <span className={`hud-value ${stats.fps < 20 ? 'hud-warn' : ''}`}>{stats.fps}</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-item">
              <span className="hud-label">FRAME</span>
              <span className="hud-value">{stats.frame.toLocaleString()}</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-item">
              <span className="hud-label">GEN</span>
              <span className="hud-value hud-green">{stats.generation}</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-item">
              <span className="hud-label">DAY</span>
              <span className="hud-value hud-green">{stats.dayCount}</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-item">
              <span className="hud-label">TIME</span>
              <span className="hud-value">{stats.timeOfDay}</span>
            </div>
          </div>
        </div>

        {/* ── ES-37/73: Population charts panel ── */}
        {showCharts && (
          <div className="charts-panel">
            <div className="charts-row">

              {/* Prey vs Predator over time */}
              <div className="chart-card">
                <div className="chart-title">Population by Species</div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={popHistory} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <XAxis
                      dataKey="t"
                      tick={{ fill: '#4a6a80', fontSize: 9, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={{ stroke: '#1e2d3d' }}
                      label={{ value: 'day', position: 'insideRight', offset: 0, fill: '#4a6a80', fontSize: 9 }}
                    />
                    <YAxis
                      tick={{ fill: '#4a6a80', fontSize: 9, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<PopTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a6a80', paddingTop: 4 }}
                    />
                    <Line
                      type="monotone" dataKey="prey" name="Prey"
                      stroke="#44dd88" strokeWidth={1.5} dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone" dataKey="predator" name="Predators"
                      stroke="#ff4444" strokeWidth={1.5} dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Total alive over time */}
              <div className="chart-card">
                <div className="chart-title">Total Population</div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={popHistory} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <XAxis
                      dataKey="t"
                      tick={{ fill: '#4a6a80', fontSize: 9, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={{ stroke: '#1e2d3d' }}
                    />
                    <YAxis
                      tick={{ fill: '#4a6a80', fontSize: 9, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<PopTooltip />} />
                    <Line
                      type="monotone" dataKey="alive" name="Total"
                      stroke="#00aaff" strokeWidth={1.5} dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

            </div>
          </div>
        )}

        {/* Stats bar */}
        <div className="stats-bar">
          <StatBadge label="ALIVE"      value={stats.alive} />
          <div className="stats-sep" />
          <StatBadge label="PREY"       value={stats.prey}     color="#44dd88" />
          <StatBadge label="PREDATORS"  value={stats.predator} color="#ff4444" />
          <div className="stats-sep" />
          <StatBadge label="AVG ENERGY" value={`${stats.avgEnergy}%`} />
          <StatBadge label="AVG AGE"    value={Math.round(stats.avgAge)} />
          <div className="stats-sep" />
          <StatBadge label="FREE SLOTS" value={stats.free} />
          <div className="stats-fill" />
          <span className="stats-brand">EcoSim · CSC 583</span>
        </div>
      </div>

    </div>
  )
}