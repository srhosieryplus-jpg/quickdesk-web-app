import { supabase } from './supabase'
import { User } from './types'

/** Check if a userid belongs to an admin account (store === 'ALL').
 *  Returns the user record if found, null if not found. */
export async function lookupUser(userid: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('userid', userid.toUpperCase().trim())
    .single()
  if (error || !data) return null
  return data as User
}

/** Full login: for admin accounts (store === 'ALL') the password must match.
 *  For non-admin accounts the password param is ignored. */
export async function loginUser(userid: string, password?: string): Promise<User | 'wrong-password' | null> {
  const user = await lookupUser(userid)
  if (!user) return null
  if (user.store === 'ALL') {
    // Admin: password required
    const { data } = await supabase
      .from('users')
      .select('password')
      .eq('userid', userid.toUpperCase().trim())
      .single()
    const stored = (data as any)?.password
    if (!stored) return null                       // admin with no password set — block
    if (!password || password !== stored) return 'wrong-password'
  }
  return user
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
