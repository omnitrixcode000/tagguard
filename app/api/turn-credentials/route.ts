import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.METERED_API_KEY
  if (!apiKey) {
    // Fallback: STUN only (will work for ~70% of connections)
    return NextResponse.json({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
  }

  try {
    const res = await fetch(
      `https://tagguard.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    )
    const servers = await res.json()
    return NextResponse.json({ iceServers: servers })
  } catch {
    return NextResponse.json({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
  }
}
