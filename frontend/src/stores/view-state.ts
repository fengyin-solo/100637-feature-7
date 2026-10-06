/**
 * 列表视图状态：筛选条件、当前页、停留的那一条都持久化在 localStorage，
 * 离开页面再回来（或刷新）仍停在原来那条。只做存取，不含业务判断。
 */
const STATE_KEY = 'urban-utility-tunnel:view-state'

type ViewState = Record<string, unknown>

function read(): ViewState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(STATE_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as ViewState
  } catch {
    return {}
  }
}

function write(state: ViewState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
  }
}

export function loadViewState<T>(key: string, fallback: T): T {
  const state = read()
  return (state[key] as T) ?? cloneFallback(fallback)
}

export function saveViewState<T>(key: string, value: T): void {
  write({ ...read(), [key]: value })
}

function cloneFallback<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
