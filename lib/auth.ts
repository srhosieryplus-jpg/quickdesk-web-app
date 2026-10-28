import { supabase } from './supabase'
import { User } from './types'

export async function loginUser(userid: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('userid', userid.toUpperCase().trim())
    .single()
  if (error || !data) return null
  return data as User
}

export function getSession(): User | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem('qd_user')
  if (!raw) return null
  try { return JSON.parse(raw) as User } catch { return null }
}

export function setSession(user: User) {
  sessionStorage.setItem('qd_user', JSON.stringify(user))
}

export function clearSession() {
  sessionStorage.removeItem('qd_user')
}
