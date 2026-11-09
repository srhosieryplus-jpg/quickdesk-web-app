export interface User {
  id: string
  userid: string
  name?: string            // display name (e.g. "Jennifer Zhang")
  store: string
  location: string
  modules: string[]
  admin_stores?: string[]  // extra stores this user can view data for
}

export interface Task {
  id: string
  store: string
  location: string
  task: string
  note: string
  done: boolean
  logged_by: string
  saved_at: string
}

export interface SeasonLog {
  id: string
  season_type: string
  store: string
  location: string
  vendor: string
  invoice: string
  po_num: string
  note: string
  logged_by: string
  saved_at: string
}

export interface IcLog {
  id: string
  store: string
  order_num: string
  status: string
  po_num: string
  qty_pushed: string
  note: string
  logged_by: string
  saved_at: string
}
