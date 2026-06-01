import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { subscription, phone, scan_token } = await req.json()

  if (!subscription || !phone) {
    return NextResponse.json({ error: 'Missing subscription or phone' }, { status: 400 })
  }

  // Store push subscription on all tags owned by this phone number
  const { error } = await supabase
    .from('tags')
    .update({ push_subscription: subscription })
    .eq('owner_phone', phone)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
