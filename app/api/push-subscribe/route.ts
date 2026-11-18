import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { subscription, userid, store, location } = await req.json()
    if (!subscription || !userid) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Upsert — one subscription per user device (keyed by endpoint)
    const { error } = await supabase.from('push_subscriptions').upsert({
      userid,
      store,
      location,
      subscription,
      endpoint: (subscription as { endpoint: string }).endpoint,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
