import { getJson, setJson, useJsonRaw } from './store'
import type { Currency } from './types'

export interface AppSettings {
  /** When true, chain actions are simulated locally and labelled DEMO. */
  demoMode: boolean
  displayCurrency: Currency
}

const DEFAULTS: AppSettings = { demoMode: false, displayCurrency: 'USD' }

export function getSettings(): AppSettings {
  return { ...DEFAULTS, ...getJson<Partial<AppSettings>>('settings') }
}

export function updateSettings(patch: Partial<AppSettings>) {
  setJson('settings', { ...getSettings(), ...patch })
}

export function useSettings(): AppSettings {
  const raw = useJsonRaw('settings')
  if (!raw) return DEFAULTS
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return DEFAULTS
  }
}
