import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

webpush.setVapidDetails(
  'mailto:support@tagguard.in',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function POST(req: NextRequest) {
  // Verify shared secret so only Supabase webhooks can call this
  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { type, scan_token, message_preview } = body
  // type: 'scan' | 'message' | 'call'

  const { data: tag } = await supabase
    .from('tags')
    .select('push_subscription, asset_name')
    .eq('scan_token', scan_token)
    .single()

  if (!tag?.push_subscription) {
    return NextResponse.json({ ok: true, skipped: 'no subscription' })
  }

  const notification =
    type === 'scan'
      ? { title: `TagGuard — ${tag.asset_name} was scanned`, body: 'Someone found your item. Tap to open chat.', url: `/app/chat/${scan_token}` }
      : type === 'call'
      ? { title: `📞 Incoming call for ${tag.asset_name}`, body: 'A finder wants to talk. Tap to answer.', url: `/app/chat/${scan_token}` }
      : { title: `💬 New message for ${tag.asset_name}`, body: message_preview || 'Someone sent you a message.', url: `/app/chat/${scan_token}` }

  try {
    await webpush.sendNotification(
      tag.push_subscription as any,
      JSON.stringify(notification)
    )
  } catch (err: any) {
    // Subscription expired — clear it
    if (err.statusCode === 410) {
      await supabase
        .from('tags')
        .update({ push_subscription: null })
        .eq('scan_token', scan_token)
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
