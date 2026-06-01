'use client'
import { useEffect, useRef, useState, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

type Step = 'install' | 'scan' | 'form' | 'done'

function ActivatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenParam = searchParams.get('token')
  const supabase = useMemo(() => createClient(), [])

  // null = waiting for client mount to determine correct step
  const [step, setStep] = useState<Step | null>(null)
  const [token, setToken] = useState(tokenParam || '')
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pushGranted, setPushGranted] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)

  const [form, setForm] = useState({
    asset_name: '',
    asset_type: 'Bag',
    message_to_finder: "Hi! You've found my item. Please tap Chat to reach me.",
    owner_name: '',
    owner_phone: '',
    privacy: 'chat_only',
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const jsQRRef = useRef<any>(null)

  // Client-only: determine step and capture install prompt
  useEffect(() => {
    const ua = navigator.userAgent
    const ios = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream
    setIsIOS(ios)

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true

    if (standalone) {
      // Already installed — go straight to the right step
      setStep(tokenParam ? 'form' : 'scan')
    } else {
      // Not installed — must install first
      setStep('install')
      // Save token so /app can resume here after install
      if (tokenParam) localStorage.setItem('tg_pending_token', tokenParam)
    }

    // Pick up prompt captured by the global listener in layout.tsx
    if ((window as any).__pwaInstallPrompt) {
      setInstallPrompt((window as any).__pwaInstallPrompt)
    }
    // Also listen for future fires (can happen after a short delay)
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [tokenParam])

  // Auto-start camera on scan step
  useEffect(() => {
    if (step === 'scan') startCamera()
    return () => stopCamera()
  }, [step])

  // Pre-fill phone from localStorage
  useEffect(() => {
    const phone = localStorage.getItem('tg_phone') || ''
    if (phone) setForm(f => ({ ...f, owner_phone: phone }))
  }, [])

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanning(false)
  }

  const scanFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const jsQR = jsQRRef.current
    if (!video || !canvas || !jsQR) return
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const result = jsQR(img.data, img.width, img.height)
        if (result) {
          const raw = result.data
          const match = raw.match(/\/scan\/([\w-]+)/i)
          const scannedToken = match ? match[1] : raw.trim()
          stopCamera()
          setToken(scannedToken)
          setStep('form')
          return
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanFrame)
  }

  const startCamera = async () => {
    setScanError('')
    setScanning(true)
    try {
      if (!jsQRRef.current) {
        const mod = await import('jsqr')
        jsQRRef.current = mod.default
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: 1280, height: 720 }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        scanFrame()
      }
    } catch {
      setScanError('Camera access denied. Please allow camera permission.')
      setScanning(false)
    }
  }

  const handleActivate = async () => {
    if (!form.asset_name.trim() || !form.owner_phone.trim()) {
      alert('Item name and your phone number are required.')
      return
    }
    setLoading(true)

    const { data: tag, error: lookupErr } = await supabase
      .from('tags')
      .select('id, scan_token, active, owner_phone')
      .eq('scan_token', token)
      .maybeSingle()

    if (!tag || lookupErr) {
      setLoading(false)
      alert('Tag not found. Make sure you scanned a TagGuard QR code.')
      return
    }
    if (tag.active || tag.owner_phone) {
      setLoading(false)
      alert('This tag is already registered. Contact support if it belongs to you.')
      return
    }

    const { error } = await supabase
      .from('tags')
      .update({
        asset_name: form.asset_name.trim(),
        asset_type: form.asset_type,
        message_to_finder: form.message_to_finder.trim(),
        owner_name: form.owner_name.trim(),
        owner_phone: form.owner_phone.trim(),
        privacy: form.privacy,
        active: true,
      })
      .eq('scan_token', token)
      .eq('active', false)

    setLoading(false)
    if (error) { alert('Error: ' + error.message); return }

    // Save phone to localStorage for role detection in chat
    localStorage.setItem('tg_phone', form.owner_phone.trim())

    setStep('done')

    // Request push permission after successful activation
    await requestPushPermission(form.owner_phone.trim(), token)
  }

  const requestPushPermission = async (phone: string, scanToken: string) => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (Notification.permission === 'granted') {
      setPushGranted(true)
      await subscribePush(phone, scanToken)
      return
    }
    if (Notification.permission === 'denied') return

    const result = await Notification.requestPermission()
    if (result === 'granted') {
      setPushGranted(true)
      await subscribePush(phone, scanToken)
    }
  }

  const subscribePush = async (phone: string, scanToken: string) => {
    try {
      const reg = await navigator.serviceWorker.ready
      const vapidRes = await fetch('/api/vapid-key')
      if (!vapidRes.ok) return
      const { publicKey } = await vapidRes.json()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), phone, scan_token: scanToken }),
      })
    } catch { /* silent */ }
  }

  /* ── Loading (waiting for client to determine step) ───── */
  if (step === null) return (
    <main style={{ minHeight: '100dvh', background: '#07111f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '2px solid #1e3a5f', borderTopColor: '#185FA5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  )

  /* ── Install step ─────────────────────────────────────── */
  if (step === 'install') return (
    <main style={{ minHeight: '100dvh', background: '#07111f', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <img src="/icon-192.png" alt="TagGuard" style={{ width: 80, height: 80, borderRadius: 20, marginBottom: 24 }} />
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Install TagGuard</h2>
      <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.6, maxWidth: 320, marginBottom: 32 }}>
        Install the app to activate your tag and get notified the moment your item is found.
      </p>

      {isIOS ? (
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', maxWidth: 320, width: '100%', marginBottom: 24, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 15 }}>Install on iPhone / iPad</div>
          <ol style={{ color: '#94a3b8', fontSize: 14, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
            <li>Tap <strong style={{ color: '#e2e8f0' }}>Share ⎋</strong> at the bottom of Safari</li>
            <li>Tap <strong style={{ color: '#e2e8f0' }}>Add to Home Screen</strong></li>
            <li>Open the TagGuard app icon</li>
          </ol>
        </div>
      ) : installPrompt ? (
        <button
          onClick={async () => {
            installPrompt.prompt()
            await installPrompt.userChoice
            // PWA will relaunch at /app → picks up tg_pending_token → resumes here
          }}
          style={{ background: '#185FA5', color: '#fff', border: 'none', borderRadius: 14, padding: '16px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', marginBottom: 16, width: '100%', maxWidth: 320 }}
        >
          📲 Add to Home Screen
        </button>
      ) : (
        <div style={{ maxWidth: 320, width: '100%' }}>
          <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: '16px 18px', marginBottom: 16, color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
            <strong style={{ color: '#94a3b8', display: 'block', marginBottom: 6 }}>On Android (Chrome)</strong>
            Tap the <strong style={{ color: '#e2e8f0' }}>⋮ menu</strong> → <strong style={{ color: '#e2e8f0' }}>Add to Home screen</strong>
          </div>
        </div>
      )}

      <p style={{ color: '#334155', fontSize: 12, marginTop: 16, maxWidth: 280 }}>
        Installation is required to receive notifications when your item is found.
      </p>
    </main>
  )

  /* ── Scan step ─────────────────────────────────────────── */
  if (step === 'scan') return (
    <main style={{ minHeight: '100dvh', background: '#07111f', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => router.push('/app')} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#fff' }}>Activate a tag</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Point camera at your QR sticker</div>
        </div>
      </header>

      {/* Camera viewport */}
      <div style={{ flex: 1, position: 'relative', margin: '0 16px', borderRadius: 20, overflow: 'hidden', background: '#000', maxHeight: 'calc(100dvh - 160px)' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />

        {/* Viewfinder overlay */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ position: 'relative', width: 220, height: 220 }}>
            {/* Corner marks */}
            {[
              { top: 0, left: 0, borderTop: '3px solid #fff', borderLeft: '3px solid #fff', borderRadius: '4px 0 0 0' },
              { top: 0, right: 0, borderTop: '3px solid #fff', borderRight: '3px solid #fff', borderRadius: '0 4px 0 0' },
              { bottom: 0, left: 0, borderBottom: '3px solid #fff', borderLeft: '3px solid #fff', borderRadius: '0 0 0 4px' },
              { bottom: 0, right: 0, borderBottom: '3px solid #fff', borderRight: '3px solid #fff', borderRadius: '0 0 4px 0' },
            ].map((style, i) => (
              <div key={i} style={{ position: 'absolute', width: 28, height: 28, ...style }} />
            ))}
            {/* Scan line animation */}
            <div style={{
              position: 'absolute', left: 10, right: 10, height: 2,
              background: 'linear-gradient(90deg, transparent, #185FA5, transparent)',
              borderRadius: 1,
              animation: 'scanLine 2s ease-in-out infinite',
            }} />
          </div>
        </div>

        <style>{`
          @keyframes scanLine {
            0%   { top: 20px; opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { top: calc(100% - 20px); opacity: 0; }
          }
        `}</style>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div style={{ padding: '20px 20px 40px', textAlign: 'center' }}>
        {scanError ? (
          <div style={{ color: '#f87171', fontSize: 14, marginBottom: 16 }}>{scanError}</div>
        ) : (
          <div style={{ color: '#64748b', fontSize: 14 }}>Scanning for QR code…</div>
        )}
        {scanError && (
          <button onClick={startCamera} style={{ background: '#185FA5', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Try again
          </button>
        )}
      </div>
    </main>
  )

  /* ── Form step ─────────────────────────────────────────── */
  if (step === 'form') return (
    <main style={{ minHeight: '100dvh', background: '#07111f', color: '#fff' }}>
      <header style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => setStep('scan')} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Set up your tag</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Token: {token}</div>
        </div>
      </header>

      <div style={{ padding: '24px 20px 48px', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Item name */}
        <div>
          <label style={labelStyle}>Item name *</label>
          <input
            type="text"
            placeholder="e.g. My blue backpack"
            value={form.asset_name}
            onChange={e => setForm(f => ({ ...f, asset_name: e.target.value }))}
            style={inputStyle}
          />
        </div>

        {/* Item type */}
        <div>
          <label style={labelStyle}>Item type</label>
          <select value={form.asset_type} onChange={e => setForm(f => ({ ...f, asset_type: e.target.value }))} style={inputStyle}>
            {['Bag', 'Wallet', 'Keys', 'Passport', 'Certificate', 'Laptop', 'Pet collar', 'Other'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Owner name */}
        <div>
          <label style={labelStyle}>Your name</label>
          <input
            type="text"
            placeholder="e.g. Alex"
            value={form.owner_name}
            onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
            style={inputStyle}
          />
        </div>

        {/* Owner phone */}
        <div>
          <label style={labelStyle}>Your phone number *</label>
          <input
            type="tel"
            placeholder="+1 555 000 1234"
            value={form.owner_phone}
            onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>Used only to identify you as the owner. Never shown to finders.</div>
        </div>

        {/* Message to finder */}
        <div>
          <label style={labelStyle}>Message to finder</label>
          <textarea
            rows={3}
            value={form.message_to_finder}
            onChange={e => setForm(f => ({ ...f, message_to_finder: e.target.value }))}
            style={{ ...inputStyle, resize: 'none' as const }}
          />
        </div>

        {/* Privacy */}
        <div>
          <label style={labelStyle}>Contact options for finder</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { value: 'chat_only', label: '💬 Chat only' },
              { value: 'chat_and_call', label: '📞 Chat + Call' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setForm(f => ({ ...f, privacy: opt.value }))}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', border: 'none',
                  background: form.privacy === opt.value ? '#185FA5' : 'rgba(255,255,255,0.07)',
                  color: form.privacy === opt.value ? '#fff' : '#94a3b8',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleActivate}
          disabled={loading}
          style={{
            marginTop: 8, background: loading ? '#0f4480' : '#185FA5', color: '#fff',
            border: 'none', borderRadius: 14, padding: '16px', fontSize: 16,
            fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', width: '100%',
            transition: 'background 0.15s',
          }}
        >
          {loading ? 'Activating…' : 'Activate tag →'}
        </button>
      </div>
    </main>
  )

  /* ── Done step ─────────────────────────────────────────── */
  return (
    <main style={{ minHeight: '100dvh', background: '#07111f', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ width: 72, height: 72, background: 'rgba(16,185,129,0.15)', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, fontSize: 36 }}>
        ✅
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Tag activated!</h2>
      <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.6, maxWidth: 320, marginBottom: 32 }}>
        Your item is now protected. Stick the QR label on your item. When someone finds it, you'll get notified here.
      </p>

      {pushGranted ? (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 14, padding: '14px 18px', marginBottom: 28, fontSize: 14, color: '#6ee7b7', maxWidth: 320 }}>
          🔔 Notifications enabled — you'll be alerted instantly.
        </div>
      ) : (
        <div style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 14, padding: '14px 18px', marginBottom: 28, fontSize: 14, color: '#fcd34d', maxWidth: 320 }}>
          Enable notifications so we can alert you when your item is found.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
        <button onClick={() => router.push('/app')} style={{ background: '#185FA5', color: '#fff', border: 'none', borderRadius: 14, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          Go to My Tags
        </button>
        <button onClick={() => { setStep('scan'); setToken('') }} style={{ background: 'rgba(255,255,255,0.07)', color: '#94a3b8', border: 'none', borderRadius: 14, padding: '14px', fontSize: 15, cursor: 'pointer' }}>
          Activate another tag
        </button>
      </div>
    </main>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600,
  color: '#94a3b8', marginBottom: 8,
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
  padding: '12px 14px', fontSize: 15, color: '#f1f5f9',
  outline: 'none', boxSizing: 'border-box',
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export default function Activate() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: '100dvh', background: '#07111f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '2px solid #334155', borderTopColor: '#185FA5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    }>
      <ActivatePage />
    </Suspense>
  )
}
