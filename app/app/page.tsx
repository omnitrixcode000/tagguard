'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

export default function AppHome() {
  const router = useRouter()
  const [installed, setInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [pushGranted, setPushGranted] = useState(false)
  const [tags, setTags] = useState<any[]>([])
  const [loadingTags, setLoadingTags] = useState(true)
  const supabaseRef = useRef<any>(null)

  useEffect(() => {
    setInstalled(isStandalone())
    const ua = navigator.userAgent
    setIsIOS(/iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream)
    setPushGranted(Notification.permission === 'granted')

    // If user just installed after scanning a QR, route through login → activate
    const pendingToken = localStorage.getItem('tg_pending_token')
    if (pendingToken) {
      const activateUrl = `/app/activate?token=${pendingToken}`
      localStorage.removeItem('tg_pending_token')
      import('@/lib/supabase').then(({ createClient: cc }) => {
        cc().auth.getSession().then(({ data: { session } }) => {
          if (session) {
            router.replace(activateUrl)
          } else {
            router.replace(`/auth?next=${encodeURIComponent(activateUrl)}`)
          }
        })
      })
      return
    }

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const load = async () => {
      const { createClient: cc } = await import('@/lib/supabase')
      const supabase = cc()
      supabaseRef.current = supabase
      const { data: { session } } = await supabase.auth.getSession()
      const phone = typeof window !== 'undefined' ? localStorage.getItem('tg_phone') : null
      if (phone) {
        const { data } = await supabase
          .from('tags')
          .select('id, asset_name, asset_type, scan_token, active')
          .eq('owner_phone', phone)
          .eq('active', true)
          .order('id', { ascending: false })
        setTags(data || [])
      }
      setLoadingTags(false)
    }
    load()
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      setInstalled(true)
      setInstallPrompt(null)
    }
  }

  const requestPush = async () => {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    if (result === 'granted') {
      setPushGranted(true)
      // Subscribe to push and save to server
      try {
        const reg = await navigator.serviceWorker.ready
        const vapidRes = await fetch('/api/vapid-key')
        const { publicKey } = await vapidRes.json()
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
        const phone = localStorage.getItem('tg_phone')
        await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), phone }),
        })
      } catch { /* push subscription failed silently */ }
    }
  }

  const ASSET_EMOJI: Record<string, string> = {
    Bag: '🎒', Passport: '🛂', Keys: '🔑', Wallet: '👛',
    Laptop: '💻', Certificate: '📜', 'Pet collar': '🐾', Other: '📦',
  }

  return (
    <main style={{ minHeight: '100dvh', background: '#07111f', color: '#fff', fontFamily: 'inherit' }}>

      {/* Header */}
      <header style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/icon-192.png" alt="TagGuard" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px' }}>TagGuard</span>
        </div>
        <Link href="/dashboard" style={{ color: '#94a3b8', fontSize: 13, textDecoration: 'none' }}>
          Dashboard →
        </Link>
      </header>

      <div style={{ padding: '32px 20px', maxWidth: 480, margin: '0 auto' }}>

        {/* Install banner — show only if not installed */}
        {!installed && (
          <div style={{
            background: 'rgba(24,95,165,0.18)',
            border: '1px solid rgba(24,95,165,0.4)',
            borderRadius: 16,
            padding: '16px 18px',
            marginBottom: 24,
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 28, lineHeight: 1 }}>📲</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                Install TagGuard
              </div>
              {isIOS ? (
                <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                  Tap <strong style={{ color: '#e2e8f0' }}>Share ⎋</strong> → <strong style={{ color: '#e2e8f0' }}>Add to Home Screen</strong> to get notified when your item is found.
                </div>
              ) : (
                <>
                  <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                    Add to home screen to get instant alerts when your item is found.
                  </div>
                  {installPrompt && (
                    <button onClick={handleInstall} style={{
                      background: '#185FA5', color: '#fff', border: 'none',
                      borderRadius: 10, padding: '8px 16px', fontSize: 13,
                      fontWeight: 700, cursor: 'pointer', width: '100%',
                    }}>
                      Add to Home Screen
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Push permission banner */}
        {installed && !pushGranted && (
          <div style={{
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 16,
            padding: '16px 18px',
            marginBottom: 24,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🔔 Enable notifications</div>
            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
              Get notified the moment someone scans your tag or sends a message.
            </div>
            <button onClick={requestPush} style={{
              background: '#10b981', color: '#fff', border: 'none',
              borderRadius: 10, padding: '10px 16px', fontSize: 14,
              fontWeight: 700, cursor: 'pointer', width: '100%',
            }}>
              Allow notifications
            </button>
          </div>
        )}

        {/* Primary action */}
        <Link href="/app/activate" style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}>
          <div style={{
            background: 'linear-gradient(135deg, #185FA5 0%, #0f4480 100%)',
            borderRadius: 20,
            padding: '28px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            cursor: 'pointer',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, flexShrink: 0,
            }}>
              📷
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Activate a tag</div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 1.4 }}>
                Scan the QR sticker on your item to link it to your account
              </div>
            </div>
            <svg style={{ marginLeft: 'auto', flexShrink: 0, opacity: 0.6 }} width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 4l6 6-6 6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </Link>

        {/* My tags */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            My Tags
          </div>

          {loadingTags ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#475569' }}>
              <div style={{ width: 28, height: 28, border: '2px solid #334155', borderTopColor: '#185FA5', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : tags.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.1)',
              borderRadius: 16,
              padding: '32px 24px',
              textAlign: 'center',
              color: '#475569',
              fontSize: 14,
            }}>
              No tags activated yet.<br />
              <span style={{ fontSize: 12, marginTop: 4, display: 'block' }}>Scan your first QR sticker above.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tags.map(tag => (
                <Link key={tag.id} href={`/app/chat/${tag.scan_token}`} style={{ textDecoration: 'none' }}>
                  <div style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                  }}>
                    <span style={{ fontSize: 28 }}>{ASSET_EMOJI[tag.asset_type] ?? '📦'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#e2e8f0' }}>{tag.asset_name}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>#{tag.id}</div>
                    </div>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} title="Active" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Footer links */}
        <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'center', gap: 24 }}>
          <Link href="/dashboard" style={{ color: '#475569', fontSize: 13, textDecoration: 'none' }}>Dashboard</Link>
          <Link href="/auth" style={{ color: '#475569', fontSize: 13, textDecoration: 'none' }}>Account</Link>
          <a href="/" style={{ color: '#475569', fontSize: 13, textDecoration: 'none' }}>About</a>
        </div>
      </div>
    </main>
  )
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
