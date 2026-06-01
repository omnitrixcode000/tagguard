'use client'
import { useEffect, useMemo, useState, use } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import SupportWidget from '@/app/components/SupportWidget'

function DownloadScreen({ token }: { token: string }) {
  const [isIOS, setIsIOS] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent
    setIsIOS(/iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream)

    // Save token so app can resume activate flow after install + login
    localStorage.setItem('tg_pending_token', token)

    // Pick up prompt captured globally in layout.tsx
    if ((window as any).__pwaInstallPrompt) setInstallPrompt((window as any).__pwaInstallPrompt)
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [token])

  if (installed) return (
    <main style={{ minHeight: '100dvh', background: '#07111f', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>✅</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>App installed!</h2>
      <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.6, maxWidth: 300, marginBottom: 28 }}>
        Open the TagGuard app from your home screen to sign in and activate this tag.
      </p>
    </main>
  )

  return (
    <main style={{ minHeight: '100dvh', background: '#07111f', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <img src="/icon-192.png" alt="TagGuard" style={{ width: 80, height: 80, borderRadius: 22, marginBottom: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }} />

      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Download TagGuard</h2>
      <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.6, maxWidth: 300, marginBottom: 32 }}>
        This tag hasn't been activated yet. Install the app, sign in, and link it to your item — takes 30 seconds.
      </p>

      {isIOS ? (
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 18, padding: '20px 22px', maxWidth: 340, width: '100%', marginBottom: 24, textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#e2e8f0' }}>Install on iPhone / iPad</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['1', 'Tap Share ⎋ at the bottom of Safari'],
              ['2', 'Tap "Add to Home Screen"'],
              ['3', 'Open the TagGuard app and sign in'],
            ].map(([n, text]) => (
              <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#185FA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{n}</div>
                <div style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.5, paddingTop: 3 }}>{text}</div>
              </div>
            ))}
          </div>
        </div>
      ) : installPrompt ? (
        <button
          onClick={async () => {
            installPrompt.prompt()
            const { outcome } = await installPrompt.userChoice
            if (outcome === 'accepted') setInstalled(true)
          }}
          style={{ background: '#185FA5', color: '#fff', border: 'none', borderRadius: 14, padding: '16px 0', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%', maxWidth: 340, marginBottom: 12 }}
        >
          📲 Install TagGuard
        </button>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 18, padding: '18px 22px', maxWidth: 340, width: '100%', marginBottom: 24, textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: '#e2e8f0' }}>Install on Android</div>
          <div style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>
            Tap the <strong style={{ color: '#e2e8f0' }}>⋮ menu</strong> in Chrome → <strong style={{ color: '#e2e8f0' }}>Add to Home screen</strong>
          </div>
        </div>
      )}

      <p style={{ color: '#334155', fontSize: 12, marginTop: 8 }}>
        Free to install · No app store required
      </p>
    </main>
  )
}

type Tag = {
  id: string
  asset_name: string
  asset_type: string
  message_to_finder: string
  owner_name: string
  owner_phone: string
}

const ASSET_EMOJI: Record<string, string> = {
  Bag: '🎒', Passport: '🛂', Keys: '🔑', Wallet: '👛', Laptop: '💻',
  Certificate: '📜', 'Pet collar': '🐾', Luggage: '🧳', Other: '📦',
}
function assetEmoji(type: string) { return ASSET_EMOJI[type] ?? '📦' }

export default function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [tag,     setTag]     = useState<Tag | null>(null)
  const [loading, setLoading] = useState(true)
  const router   = useRouter()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('tags')
        .select('*')
        .eq('scan_token', token)
        .eq('active', true)
        .single()

      if (!data) {
        // Tag not registered — show neutral page (owner or finder can self-identify)
        setLoading(false)
        return
      }

      setTag(data)

      if (data) {
        /* Insert scan event, get back the row ID */
        const { data: eventRow } = await supabase
          .from('scan_events')
          .insert({
            tag_id:     data.id,
            scan_token: token,
            scanned_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        /* ── Geolocation capture ─────────────────────
           Location is shared with the tag owner only,
           to help recover the lost item. The browser
           will show its own permission prompt. Denied
           or unavailable = silently skipped.
        ────────────────────────────────────────────── */
        // Notify owner of new scan (fire-and-forget)
        fetch('/api/notify-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-secret': '' },
          body: JSON.stringify({ type: 'scan', scan_token: token }),
        }).catch(() => {})

        if (navigator.geolocation && eventRow?.id) {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              await supabase
                .from('scan_events')
                .update({
                  lat:      pos.coords.latitude,
                  lng:      pos.coords.longitude,
                  accuracy: Math.round(pos.coords.accuracy),
                })
                .eq('id', eventRow.id)
            },
            () => { /* permission denied or unavailable — ignore */ },
            { timeout: 10000, maximumAge: 0 }
          )
        }
      }

      setLoading(false)
    }

    load()
  }, [token, supabase])

  /* ── Loading ──────────────────────────────────── */
  if (loading) return (
    <main className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </main>
  )

  /* ── Not registered — prompt owner to download app ──────── */
  if (!tag) return <DownloadScreen token={token} />

  /* ── Found ────────────────────────────────────── */
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">

      {/* Topbar */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 text-center">
        <span className="font-bold text-gray-900 tracking-tight">TagGuard</span>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mb-6 text-3xl">
          {assetEmoji(tag.asset_type)}
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-1 tracking-tight">{tag.asset_name}</h1>
        {tag.owner_name && (
          <p className="text-gray-400 text-sm mb-6">Belongs to {tag.owner_name}</p>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-8 max-w-sm w-full text-left shadow-sm">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">
            Message from owner
          </p>
          <p className="text-gray-700 text-sm leading-relaxed">"{tag.message_to_finder}"</p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm">
          <button
            onClick={() => router.push(`/chat/${token}`)}
            className="w-full bg-teal-600 text-white py-4 rounded-xl font-semibold text-base hover:bg-teal-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M18 10c0 4.418-3.582 8-8 8a8.002 8.002 0 0 1-6.938-4H2l1.5-2C2.557 10.938 2 9.535 2 8c0-4.418 3.582-8 8-8s8 3.582 8 8z"
                stroke="white" strokeWidth="1.5"/>
            </svg>
            Chat now
          </button>

          {tag.owner_phone && (
            <button
              onClick={() => router.push(`/chat/${token}?mode=call`)}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-semibold text-base hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M2 3a1 1 0 011-1h3.5a1 1 0 01.95.68l1.1 3.3a1 1 0 01-.23 1.02L6.91 8.41a11.05 11.05 0 005.68 5.68l1.41-1.41a1 1 0 011.02-.23l3.3 1.1a1 1 0 01.68.95V17a1 1 0 01-1 1A15 15 0 012 3z"
                  stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Call owner
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-6 py-5 bg-white space-y-3">
        <p className="text-xs text-gray-400 text-center">
          📍 Your approximate location may be shared with the tag owner to help recover this item.
        </p>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-gray-300">Powered by TagGuard · tagguard.in</p>
          <SupportWidget
            label="Contact support"
            variant="inline"
            context="scan_page"
          />
        </div>
      </div>
    </main>
  )
}
