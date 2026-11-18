import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

webpush.setVapidDetails(
  'mailto:quickdesk@quickdesk-web-app.vercel.app',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { title, body, assignedTo, location, store, url } = await req.json()

    // Build query for matching subscriptions
    // - If assigned to someone: notify that person only
    // - If unassigned: notify everyone at the same location
    let query = supabase.from('push_subscriptions').select('subscription')

    if (assignedTo) {
      query = query.ilike('userid', assignedTo)
    } else {
      // Notify all users at the same location (excluding admin store ALL)
      query = query.eq('location', location).neq('store', 'ALL')
    }

    const { data: subs, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!subs || subs.length === 0) return NextResponse.json({ sent: 0 })

    const payload = JSON.stringify({ title, body, url: url || '/tasks', tag: 'quickdesk-task' })

    const results = await Promise.allSettled(
      subs.map((row: { subscription: webpush.PushSubscription }) =>
        webpush.sendNotification(row.subscription, payload)
      )
    )

    const sent = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return NextResponse.json({ sent, failed })
  } catch (err) {
    console.error('Push error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
