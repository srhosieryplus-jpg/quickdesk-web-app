import { NextRequest, NextResponse } from 'next/server'
import * as webpush from 'web-push'
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

async function sendToSubs(subs: { subscription: webpush.PushSubscription }[], payload: string) {
  const results = await Promise.allSettled(
    subs.map((row) => webpush.sendNotification(row.subscription, payload))
  )
  return {
    sent: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, body: msgBody, assignedTo, location, store, url } = body

    // ── Mode 1: order push (array of store IDs) ──────────────────────────────
    // Payload shape: { orders: [{ store, poNums: string[] }], pushedBy: string }
    if (body.orders) {
      const { orders, pushedBy } = body as {
        orders: { store: string; poNums: string[] }[]
        pushedBy: string
      }

      let totalSent = 0
      let totalFailed = 0

      // Notify each store's users
      for (const order of orders) {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('subscription')
          .eq('store', order.store)

        if (!subs || subs.length === 0) continue

        const poList = order.poNums.join(', ')
        const payload = JSON.stringify({
          title: `📦 Order pushed to ${order.store}`,
          body: `PO#: ${poList} — pushed by ${pushedBy}`,
          url: '/ic-log',
          tag: `order-push-${order.store}`,
        })

        const r = await sendToSubs(subs, payload)
        totalSent += r.sent
        totalFailed += r.failed
      }

      // Notify admins (store = ALL) with a full summary
      const { data: adminSubs } = await supabase
        .from('push_subscriptions')
        .select('subscription')
        .eq('store', 'ALL')

      if (adminSubs && adminSubs.length > 0) {
        const storeList = orders.map(o => `${o.store}: PO# ${o.poNums.join(', ')}`).join(' | ')
        const payload = JSON.stringify({
          title: `📦 Orders pushed (${orders.length} store${orders.length !== 1 ? 's' : ''})`,
          body: storeList,
          url: '/autocsv',
          tag: 'order-push-admin',
        })
        const r = await sendToSubs(adminSubs, payload)
        totalSent += r.sent
        totalFailed += r.failed
      }

      return NextResponse.json({ sent: totalSent, failed: totalFailed })
    }

    // ── Mode 2: task / UPC notification ──────────────────────────────────────
    console.log('[push] mode2 — assignedTo:', assignedTo, '| store:', store, '| location:', location)
    let subs: { subscription: webpush.PushSubscription }[] | null = null

    if (assignedTo) {
      // Try to find the specific user's subscription first
      const { data, error: e1 } = await supabase
        .from('push_subscriptions')
        .select('subscription, userid, store')
        .ilike('userid', assignedTo)
      console.log('[push] userid lookup:', assignedTo, '→ found', data?.length ?? 0, 'rows', e1 ? e1.message : '')
      subs = data && data.length > 0 ? data : null

      // Fallback: send to all subscriptions for that store if user not found
      if (!subs && store) {
        const { data: storeSubs, error: e2 } = await supabase
          .from('push_subscriptions')
          .select('subscription, userid, store')
          .eq('store', store)
        console.log('[push] store fallback:', store, '→ found', storeSubs?.length ?? 0, 'rows', e2 ? e2.message : '')
        subs = storeSubs && storeSubs.length > 0 ? storeSubs : null
      }

      // Last resort: send to ALL store subscriptions (store=ALL means admin)
      if (!subs) {
        const { data: allSubs } = await supabase
          .from('push_subscriptions')
          .select('subscription, userid, store')
          .eq('store', 'ALL')
        console.log('[push] ALL fallback → found', allSubs?.length ?? 0, 'rows')
        subs = allSubs && allSubs.length > 0 ? allSubs : null
      }
    } else {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('subscription')
        .eq('location', location)
        .neq('store', 'ALL')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      subs = data
    }

    console.log('[push] final subs count:', subs?.length ?? 0)
    if (!subs || subs.length === 0) return NextResponse.json({ sent: 0, debug: { assignedTo, store, location } })

    const payload = JSON.stringify({ title, body: msgBody, url: url || '/tasks', tag: 'quickdesk-task' })
    const result = await sendToSubs(subs, payload)
    console.log('[push] result:', result)

    return NextResponse.json(result)
  } catch (err) {
    console.error('Push error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
