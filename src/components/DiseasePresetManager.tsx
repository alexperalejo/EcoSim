/**
 * ES-83: Save/reload disease simulation presets
 *
 * Manages named DiseaseStrain presets using localStorage.
 * Allows professors to save current strain parameters under a name,
 * reload them in future sessions, and delete presets they no longer need.
 *
 * Props:
 *   currentStrain  — the active strain whose values will be saved
 *   onLoadPreset   — called with the loaded strain when a preset is selected
 */

import { useState, useEffect, useCallback } from 'react'
import { DiseaseStrain } from '../simulation/disease/disease'

// ── Types ────────────────────────────────────────────────────────────

interface DiseasePresetManagerProps {
  /** Current active strain — saved when user clicks Save */
  currentStrain: DiseaseStrain
  /** Called with loaded strain data when user selects a preset */
  onLoadPreset: (strain: DiseaseStrain) => void
}

interface SavedPreset {
  name: string
  strain: DiseaseStrain
}

// ── Storage key ──────────────────────────────────────────────────────

const STORAGE_KEY = 'ecosim-disease-presets'

// ── Persistence helpers ──────────────────────────────────────────────

function loadPresetsFromStorage(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function savePresetsToStorage(presets: SavedPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    console.error('ES-83: failed to write presets to localStorage')
  }
}

// ── Component ────────────────────────────────────────────────────────

export default function DiseasePresetManager({
  currentStrain,
  onLoadPreset,
}: DiseasePresetManagerProps) {
  const [presets, setPresets] = useState<SavedPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)

  // Load presets from localStorage on mount
  useEffect(() => {
    setPresets(loadPresetsFromStorage())
  }, [])

  // Save current strain as a new preset
  const handleSave = useCallback(() => {
    const trimmed = presetName.trim()
    if (trimmed.length === 0) return

    const newPreset: SavedPreset = {
      name: trimmed,
      strain: { ...currentStrain },
    }

    // Overwrite if name already exists, otherwise append
    const existingIndex = presets.findIndex(p => p.name === trimmed)
    let updated: SavedPreset[]
    if (existingIndex >= 0) {
      updated = [...presets]
      updated[existingIndex] = newPreset
    } else {
      updated = [...presets, newPreset]
    }

    setPresets(updated)
    savePresetsToStorage(updated)
    setPresetName('')
    setSelectedIndex(updated.length - 1)
  }, [presetName, currentStrain, presets])

  // Load selected preset
  const handleLoad = useCallback(() => {
    if (selectedIndex < 0 || selectedIndex >= presets.length) return
    onLoadPreset({ ...presets[selectedIndex].strain })
  }, [selectedIndex, presets, onLoadPreset])

  // Delete selected preset
  const handleDelete = useCallback(() => {
    if (selectedIndex < 0 || selectedIndex >= presets.length) return
    const updated = presets.filter((_, i) => i !== selectedIndex)
    setPresets(updated)
    savePresetsToStorage(updated)
    setSelectedIndex(-1)
  }, [selectedIndex, presets])

  return (
    <div style={{ marginBottom: '12px' }}>
      <div className="section-label" style={{ marginBottom: '6px' }}>PRESETS</div>

      {/* Dropdown + Load + Delete */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        <select
          value={selectedIndex}
          onChange={e => setSelectedIndex(parseInt(e.target.value))}
          style={{
            flex: 1,
            background: '#0d1117',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: '4px',
            padding: '4px 6px',
            fontSize: '12px',
          }}
        >
          <option value={-1}>— Select preset —</option>
          {presets.map((p, i) => (
            <option key={i} value={i}>{p.name}</option>
          ))}
        </select>
        <button
          className="btn-secondary"
          disabled={selectedIndex < 0}
          onClick={handleLoad}
          style={{ fontSize: '11px', padding: '4px 8px' }}
        >
          Load
        </button>
        <button
          className="btn-secondary"
          disabled={selectedIndex < 0}
          onClick={handleDelete}
          style={{ fontSize: '11px', padding: '4px 8px' }}
        >
          ✕
        </button>
      </div>

      {/* Name input + Save */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <input
          type="text"
          value={presetName}
          onChange={e => setPresetName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          placeholder="Preset name..."
          style={{
            flex: 1,
            background: '#0d1117',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
          }}
        />
        <button
          className="btn-secondary"
          disabled={presetName.trim().length === 0}
          onClick={handleSave}
          style={{ fontSize: '11px', padding: '4px 8px' }}
        >
          Save
        </button>
      </div>
    </div>
  )
}