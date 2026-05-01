/**
 * ES-80: Pathogen parameter sliders (live update, no reset)
 * ES-82: Inject Antibodies button
 *
 * Disease control panel providing real-time adjustment of active
 * strain parameters during simulation. All changes apply immediately
 * to the running simulation without requiring a reset.
 *
 * Props:
 *   strain              — current DiseaseStrain being simulated
 *   onStrainChange      — called with updated strain when any slider moves
 *   onInjectAntibodies  — called when Inject Antibodies button is clicked
 *   disabled            — disables all controls (e.g. when sim is paused)
 */

import { useCallback } from 'react'
import { DiseaseStrain } from '../simulation/disease/disease'

// ── Types ────────────────────────────────────────────────────────────

interface DiseaseControlPanelProps {
  /** Active disease strain — slider values are read from this */
  strain: DiseaseStrain
  /** Callback fired when any parameter slider changes */
  onStrainChange: (updated: DiseaseStrain) => void
  /** Callback fired when Inject Antibodies button is clicked */
  onInjectAntibodies: () => void
  /** Disables all controls when true */
  disabled?: boolean
}

// ── Slider (local, matches App.tsx pattern) ──────────────────────────

interface SliderProps {
  label:    string
  value:    number
  min:      number
  max:      number
  step:     number
  unit?:    string
  disabled: boolean
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, unit = '', disabled, onChange }: SliderProps) {
  return (
    <div className="slider-row">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value.toFixed(step < 0.1 ? 2 : 1)}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        disabled={disabled}
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

// ── Component ────────────────────────────────────────────────────────

export default function DiseaseControlPanel({
  strain,
  onStrainChange,
  onInjectAntibodies,
  disabled = false,
}: DiseaseControlPanelProps) {

  // Generic updater — creates a new strain object with one property changed.
  // Spreading preserves all other fields including strainId.
  const updateParam = useCallback(
    (key: keyof DiseaseStrain, value: number) => {
      onStrainChange({ ...strain, [key]: value })
    },
    [strain, onStrainChange]
  )

  return (
    <section className="sidebar-section">
      <div className="section-label">DISEASE</div>

      <Slider
        label="Transmission Rate"
        value={strain.transmissionRate}
        min={0.0} max={1.0} step={0.01}
        disabled={disabled}
        onChange={v => updateParam('transmissionRate', v)}
      />

      <Slider
        label="Mutation Rate"
        value={strain.mutationRate}
        min={0.0} max={1.0} step={0.01}
        disabled={disabled}
        onChange={v => updateParam('mutationRate', v)}
      />

      <Slider
        label="Antibody Resistance"
        value={strain.antibodyResistance}
        min={0.0} max={1.0} step={0.01}
        disabled={disabled}
        onChange={v => updateParam('antibodyResistance', v)}
      />

      <Slider
        label="Incubation Period"
        value={strain.incubationPeriod}
        min={1} max={30} step={1}
        unit=" days"
        disabled={disabled}
        onChange={v => updateParam('incubationPeriod', v)}
      />

      <button
        className="btn-secondary"
        disabled={disabled}
        onClick={onInjectAntibodies}
        style={{ marginTop: '8px', width: '100%' }}
      >
        💉  Inject Antibodies
      </button>
    </section>
  )
}