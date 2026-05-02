/**
 * src/simulation/firebaseSync.ts
 *
 * ES-71 / ES-72 — Save, Load, and Share simulations via Firestore.
 */

import { collection, addDoc, getDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// ── Types ─────────────────────────────────────────────────────────────

export interface SimulationSnapshot {
  name:       string
  params:     Record<string, number>
  alive:      number
  generation: number
  preset:     string
  createdAt:  number | null  // Firestore server timestamp, null before write
}

// ── Save ──────────────────────────────────────────────────────────────

export async function saveSimulation(
  params:     Record<string, number>,
  alive:      number,
  generation: number,
  name:       string,
  preset:     string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'simulations'), {
    name,
    params,
    alive,
    generation,
    preset,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

// ── Load ──────────────────────────────────────────────────────────────

export async function loadSimulation(id: string): Promise<SimulationSnapshot | null> {
  const snap = await getDoc(doc(db, 'simulations', id))
  if (!snap.exists()) return null
  return snap.data() as SimulationSnapshot
}

// ── Share URL helpers ─────────────────────────────────────────────────

export function getShareURL(id: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('sim', id)
  return url.toString()
}

export function getSimIDFromURL(): string | null {
  return new URLSearchParams(window.location.search).get('sim')
}
