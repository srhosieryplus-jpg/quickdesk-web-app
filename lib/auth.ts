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

/** Check if a user has a password set in Supabase without attempting login. */
export async function hasPassword(userid: string): Promise<boolean> {
  const { data } = await supabase
    .from('users')
    .select('password')
    .eq('userid', userid.toUpperCase().trim())
    .single()
  const stored = (data as any)?.password as string | null | undefined
  return !!stored
}

/** Full login: if the user has a password set in Supabase, it must match.
 *  Users with no password set can log in without one. */
export async function loginUser(userid: string, password?: string): Promise<User | 'wrong-password' | null> {
  const user = await lookupUser(userid)
  if (!user) return null

  // Always fetch password column to check if one is set
  const { data } = await supabase
    .from('users')
    .select('password')
    .eq('userid', userid.toUpperCase().trim())
    .single()
  const stored = (data as any)?.password as string | null | undefined

  if (stored) {
    // Password is set — must match
    if (!password || password !== stored) return 'wrong-password'
  }
  // No password set — allow in without one

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
