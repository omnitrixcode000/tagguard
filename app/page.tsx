'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import SupportWidget from './components/SupportWidget'
import s from './landing.module.css'

/* ── QR Scanner icon ─────────────────────────── */
function QrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="10" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="1" y="10" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="10" y="10" width="2.2" height="2.2" fill="currentColor" rx=".4"/>
      <rect x="13.8" y="10" width="2.2" height="2.2" fill="currentColor" rx=".4"/>
      <rect x="10" y="13.8" width="2.2" height="2.2" fill="currentColor" rx=".4"/>
      <rect x="13.8" y="13.8" width="2.2" height="2.2" fill="currentColor" rx=".4"/>
    </svg>
  )
}

export default function Home() {
  const router  = useRouter()
  const supabase = useMemo(() => createClient(), [])

  /* ── Scanner state ───────────────────────────── */
  const [scanning,   setScanning]   = useState(false)
  const [scanError,  setScanError]  = useState('')
  const [scanResult, setScanResult] = useState('')
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef    = useRef<number>(0)
  const jsQRRef   = useRef<any>(null)

  /* ── Newsletter state ────────────────────────── */
  const [nlEmail,   setNlEmail]   = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [nlDone,    setNlDone]    = useState(false)
  const [nlError,   setNlError]   = useState('')

  const handleSubscribe = async () => {
    const email = nlEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNlError('Please enter a valid email address.')
      return
    }
    setNlLoading(true); setNlError('')
    await supabase.from('subscribers').insert({
      email,
      source:      'landing_page',
      created_at:  new Date().toISOString(),
    })
    setNlLoading(false)
    setNlDone(true)
  }

  /* ── Scroll reveal + parallax ────────────────── */
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('[data-reveal]'))
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add(s.show) }),
      { threshold: 0.14, rootMargin: '0px 0px -60px 0px' }
    )
    els.forEach(el => io.observe(el))

    const stage = document.querySelector('[data-stage]') as HTMLElement | null
    const onScroll = () => {
      if (stage) stage.style.transform = `translateY(${Math.min(window.scrollY * 0.03, 28)}px)`
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])

  /* ── Scanner helpers ─────────────────────────── */
  const stopScan = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanError('')
    setScanResult('')
    setScanning(false)
  }

  const handleScanned = async (raw: string) => {
    const match = raw.match(/\/scan\/([A-Za-z0-9-]+)/)
    const token = match ? match[1] : raw.trim()
    setScanResult('Checking tag…')

    /* Check if tag is registered */
    const { data } = await supabase
      .from('tags')
      .select('id, active, owner_phone')
      .eq('scan_token', token)
      .maybeSingle()

    stopScan()

    /* Always go to /scan/<token> — that page handles both registered and unregistered cases */
    router.push(`/scan/${token}`)
  }

  const scanFrame = () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    const jsQR   = jsQRRef.current
    if (!video || !canvas || !jsQR) return
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        const img    = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const result = jsQR(img.data, img.width, img.height)
        if (result) { handleScanned(result.data); return }
      }
    }
    rafRef.current = requestAnimationFrame(scanFrame)
  }

  const openScanner = async () => {
    setScanError('')
    setScanResult('')
    setScanning(true)
    try {
      if (!jsQRRef.current) {
        const mod = await import('jsqr')
        jsQRRef.current = mod.default
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: 640, height: 640 }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        scanFrame()
      }
    } catch {
      setScanError('Camera access denied. Please allow camera permission and try again.')
    }
  }

  /* cleanup on unmount */
  useEffect(() => () => stopScan(), [])

  /* helper: reveal class + optional delay */
  const r = (d?: 1 | 2 | 3) =>
    [s.reveal, d === 1 ? s.d1 : d === 2 ? s.d2 : d === 3 ? s.d3 : ''].filter(Boolean).join(' ')

  return (
    <div className={s.page}>

      {/* ── Nav ──────────────────────────────────── */}
      <nav className={s.nav}>
        <Link href="/" className={s.brand}>
          <img src="/logo.svg" alt="TagGuard" className={s.brandMark} />
          TagGuard
        </Link>

        <div className={s.navLinks}>
          <Link href="#how">How it works</Link>
          <Link href="#protect">What it protects</Link>
          <Link href="#why">Why TagGuard</Link>
          <Link href="#pricing">Pricing</Link>
        </div>

        <div className={s.navActions}>
          <Link href="/auth" className={s.loginBtn}>Login</Link>
          <button className={s.scanQrBtn} onClick={openScanner}>
            <QrIcon />
            Scan QR
          </button>
        </div>
      </nav>

      {/* ── QR Scanner overlay ───────────────────── */}
      {scanning && (
        <div className={s.scanOverlay}>
          <div className={s.scanCard}>
            <div className={s.scanHeader}>
              <span className={s.scanTitle}>Scan a TagGuard QR code</span>
              <button className={s.scanClose} onClick={stopScan} aria-label="Close scanner">×</button>
            </div>

            <div className={s.scanViewport}>
              <video ref={videoRef} className={s.scanVideo} muted playsInline />
              <div className={s.scanCorners} />
              <div className={s.scanLine} />
            </div>

            {scanError  && <p className={s.scanError}>{scanError}</p>}
            {scanResult && <p className={s.scanResult}>{scanResult}</p>}
            {!scanError && !scanResult && (
              <p className={s.scanHint}>Point your camera at the QR code on the tag</p>
            )}

            <canvas ref={canvasRef} className={s.scanCanvas} />
          </div>
        </div>
      )}

      <main>

        {/* ── Hero ─────────────────────────────────── */}
        <section className={s.hero}>
          <div>
            <div className={`${s.eyebrow} ${r()}`} data-reveal>
              Privacy-safe QR recovery tags
            </div>

            <h1 className={`${s.heroH1} ${r(1)}`} data-reveal>
              Your things can{' '}
              <span className={s.accent}>call you back.</span>
            </h1>

            <p className={`${s.heroCopy} ${r(2)}`} data-reveal>
              TagGuard gives every important item a safe return link. When someone finds it,
              they can message or call you privately — without seeing your phone number.
            </p>

            <div className={`${s.heroActions} ${r(3)}`} data-reveal>
              <Link className={`${s.btn} ${s.teal}`} href="/app">
                Get the App →
              </Link>
              <Link className={`${s.btn} ${s.ghost}`} href="#how">
                See the story
              </Link>
            </div>

            <div className={`${s.trustRow} ${r(3)}`} data-reveal>
              <span className={s.avatars}>
                {[0, 1, 2, 3].map(i => <span key={i} className={s.avatar} />)}
              </span>
              Built for bags, keys, pets, passports, certificates, and travel gear.
            </div>
          </div>

          {/* product illustration */}
          <div className={`${s.productStage} ${r(2)}`} data-reveal data-stage
            aria-label="TagGuard product illustration">
            <span className={s.glowOrb} />

            <div className={s.passport}>
              PASSPORT
              <div className={s.globe} />
            </div>

            <div className={s.suitcase} />

            <div className={`${s.tag} ${s.small}`}>
              <div className={s.tagLogo}>TagGuard</div>
              <div className={s.qr} />
            </div>
            <div className={`${s.tag} ${s.tagRound}`}>
              <div className={s.tagLogo}>TagGuard</div>
              <div className={s.qr} />
            </div>
            <div className={`${s.tag} ${s.tagCard}`}>
              <div className={s.tagLogo}>TagGuard</div>
              <div className={s.qr} />
            </div>

            <div className={s.phoneMock}>
              <div className={s.phoneScreen}>
                <div className={s.phoneNotch} />
                <div className={s.chatTitle}>TagGuard</div>
                <div className={s.secureDot}>● Secure connection</div>
                <div className={s.bubble}>Hi, I found your bag near Gate 12.</div>
                <div className={`${s.bubble} ${s.bubbleMe}`}>
                  Thank you! Can we meet at the help desk?
                </div>
                <div className={s.bubble}>Yes, I'm here.</div>
                <div className={s.callBtn}>Start private call</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Story / How it works ─────────────────── */}
        <section className={s.story} id="how">
          <div className={s.storyGrid}>
            <div>
              <div className={`${s.eyebrow} ${r()}`} data-reveal>The real problem</div>

              <h2 className={`${s.sectionTitle} ${r(1)}`} data-reveal>
                Lost isn't always gone. Sometimes it just needs a way home.
              </h2>

              <p className={`${s.sectionLead} ${s.storyLead} ${r(2)}`} data-reveal>
                Trackers help you search. TagGuard helps good people return what they found —
                instantly, privately, and without another app.
              </p>

              <div className={s.proofList}>
                {[
                  ['▢', 'No app.'],
                  ['▥', 'No battery.'],
                  ['◎', 'No personal number.'],
                ].map(([icon, text], i) => (
                  <div key={text} className={`${s.proof} ${r((i + 1) as 1 | 2 | 3)}`} data-reveal>
                    <span className={s.proofIcon}>{icon}</span>
                    {i === 2 ? <span className={s.accent}>{text}</span> : text}
                  </div>
                ))}
              </div>
            </div>

            <div className={`${s.cinemaPanel} ${r(2)}`} data-reveal>
              <div className={s.airportSeat} />
              <div className={s.terminalSign} />
              <div className={s.seatLine}>
                <div className={s.seat} /><div className={s.seat} /><div className={s.seat} />
              </div>
              <div className={s.leftBag} />
              <div className={s.scanLight}>
                <div className={s.qr} />
                <small>SCAN TO RETURN</small>
              </div>
            </div>
          </div>
        </section>

        {/* ── Steps ────────────────────────────────── */}
        <section className={s.steps}>
          <div>
            <div className={`${s.eyebrow} ${r()}`} data-reveal>Private connection</div>

            <h2 className={`${s.sectionTitle} ${r(1)}`} data-reveal
              style={{ color: 'var(--ink)' }}>
              One scan. One safe page.<br />One chance to get it back.
            </h2>

            <p className={`${s.sectionLead} ${r(2)}`} data-reveal>
              A finder scans the TagGuard QR. They see what you lost, your safe return message,
              and two simple options: chat or private call.
            </p>
          </div>

          <div className={s.phonePair}>
            <div className={`${s.uiCard} ${r(1)}`} data-reveal>
              <h3>Secure chat</h3>
              <div className={s.miniBubble}>Hi! I found your passport holder.</div>
              <div className={`${s.miniBubble} ${s.miniBubbleMe}`}>
                Thank you. Are you still at the café?
              </div>
              <div className={s.miniBubble}>Yes. I can leave it with the manager.</div>
            </div>

            <div className={`${s.uiCard} ${r(2)}`} data-reveal>
              <h3>Private call</h3>
              <div className={s.callFace} />
              <p style={{ textAlign: 'center', color: '#667385', marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
                Connecting securely…<br />Your number is never shared.
              </p>
              <div className={s.hang}>⌕</div>
            </div>
          </div>
        </section>

        {/* ── Use cases ────────────────────────────── */}
        <section className={s.usecases} id="protect">
          <div className={s.center}>
            <div className={`${s.eyebrow} ${r()}`} data-reveal style={{ justifyContent: 'center' }}>
              What it protects
            </div>
            <h2 className={`${s.sectionTitle} ${r(1)}`} data-reveal style={{ color: 'var(--ink)' }}>
              Make everyday things returnable.
            </h2>
            <p className={`${s.sectionLead} ${r(2)}`} data-reveal>
              TagGuard is made for the things you carry, travel with, depend on, and cannot afford to lose.
            </p>
          </div>

          <div className={s.caseGrid}>
            {[
              { e: '🧳', t: 'Luggage',      d: 'For airports, hotels, buses, and forgotten corners.' },
              { e: '🐶', t: 'Pets',          d: 'Help kind people contact you when your pet wanders.' },
              { e: '🛂', t: 'Passports',     d: 'A safer way back for travel documents and holders.' },
              { e: '🔑', t: 'Keys',          d: 'Small tag. Big relief when they disappear.' },
              { e: '🎒', t: 'Bags',          d: 'For backpacks, handbags, gym bags, and school bags.' },
              { e: '📜', t: 'Certificates',  d: 'Protect documents that are hard to replace.' },
              { e: '💻', t: 'Electronics',   d: 'For laptops, tablets, cameras, and headphones.' },
              { e: '🚲', t: 'Vehicles',      d: 'Let people contact you without exposing your number.' },
            ].map(({ e, t, d }, i) => (
              <div key={t} className={`${s.caseCard} ${r(((i % 4) + 1) as 1|2|3|undefined)}`} data-reveal>
                <span className={s.caseEmoji}>{e}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Compare ──────────────────────────────── */}
        <section className={s.compare} id="why">
          <div className={s.center}>
            <div className={`${s.eyebrow} ${r()}`} data-reveal style={{ justifyContent: 'center' }}>
              Why TagGuard
            </div>
            <h2 className={`${s.sectionTitle} ${r(1)}`} data-reveal>
              More useful than a label.<br />Simpler than a tracker.
            </h2>
            <p className={`${s.sectionLead} ${s.storyLead} ${r(2)}`} data-reveal
              style={{ marginLeft: 'auto', marginRight: 'auto' }}>
              TagGuard creates a safe bridge between the finder and the owner — no spying, no tracking.
            </p>
          </div>

          <div className={s.compareGrid}>
            <div className={`${s.compareCard} ${s.best} ${r()}`} data-reveal>
              <h3>TagGuard</h3>
              <ul>
                {[
                  'Finder can chat or call privately',
                  'Your phone number stays hidden',
                  'No app required for the finder',
                  'No battery or charging',
                  'Affordable for many items',
                ].map(f => <li key={f}><span className={s.check}>✓</span> {f}</li>)}
              </ul>
            </div>

            <div className={`${s.compareCard} ${r(1)}`} data-reveal>
              <h3>Paper labels</h3>
              <ul>
                {[
                  'Exposes your phone number',
                  'Easy to remove or damage',
                  'No private communication',
                  'Looks outdated',
                  'Hard to update after printing',
                ].map(f => <li key={f}><span className={s.xmark}>×</span> {f}</li>)}
              </ul>
            </div>

            <div className={`${s.compareCard} ${r(2)}`} data-reveal>
              <h3>Trackers</h3>
              <ul>
                {[
                  'Needs battery or charging',
                  'Works best inside an ecosystem',
                  'Higher cost per item',
                  'Finder may not know how to contact you',
                  'Not ideal for every asset',
                ].map(f => <li key={f}><span className={s.xmark}>×</span> {f}</li>)}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────── */}
        <section className={s.pricing} id="pricing">
          <div className={s.center}>
            <div className={`${s.eyebrow} ${r()}`} data-reveal style={{ justifyContent: 'center' }}>
              Early access
            </div>
            <h2 className={`${s.sectionTitle} ${r(1)}`} data-reveal style={{ color: 'var(--ink)' }}>
              Start small. Protect more.
            </h2>
            <p className={`${s.sectionLead} ${r(2)}`} data-reveal
              style={{ marginLeft: 'auto', marginRight: 'auto' }}>
              Launch-friendly packs for Kickstarter, pre-orders, or MVP testing.
            </p>
          </div>

          <div className={s.priceRow}>
            {([
              {
                name: 'Starter',  sub: 'For one essential item.',    price: '$19', tag: 'early',
                features: ['1 premium QR tag', 'Secure scan page', 'Basic chat'],
                popular: false, delay: undefined,
              },
              {
                name: 'Traveler', sub: 'For bags and documents.',     price: '$49', tag: 'early',
                features: ['3 premium QR tags', 'Chat + private call', 'Travel-ready profile'],
                popular: true, delay: 1 as const,
              },
              {
                name: 'Family',   sub: "For everyone's essentials.", price: '$79', tag: 'early',
                features: ['5 premium QR tags', 'Shared family dashboard', 'Priority launch access'],
                popular: false, delay: 2 as const,
              },
            ] as const).map(({ name, sub, price, tag, features, popular, delay }) => (
              <div key={name}
                className={`${s.priceCard}${popular ? ' ' + s.popular : ''} ${r(delay)}`}
                data-reveal>
                {popular && <div className={s.badge}>Most popular</div>}
                <h3>{name}</h3>
                <p className={s.priceSub}>{sub}</p>
                <div className={s.priceAmt}>{price} <small>{tag}</small></div>
                <ul>
                  {features.map(f => (
                    <li key={f}><span className={s.check}>✓</span> {f}</li>
                  ))}
                </ul>
                <Link href="/app" className={`${s.btn} ${s.teal}`}
                  style={{ width: '100%', marginTop: 8 }}>
                  Choose {name}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ── Newsletter ───────────────────────────── */}
        <section className={s.newsletter}>
          <div className={`${s.nlPill} ${r()}`} data-reveal>
            🔔 Early access
          </div>

          <h2 className={`${s.nlTitle} ${r(1)}`} data-reveal>
            Be the first to know<br />when we launch.
          </h2>

          <p className={`${s.nlSub} ${r(2)}`} data-reveal>
            Early subscribers get <strong style={{ color: '#63f1e6' }}>30% off</strong> their first
            order — plus priority access to new tag designs before anyone else.
          </p>

          <div className={`${r(3)}`} data-reveal>
            {nlDone ? (
              <p className={s.nlDone}>
                ✓ You're on the list! We'll notify you at launch.
              </p>
            ) : (
              <div className={s.nlForm}>
                <input
                  className={s.nlInput}
                  type="email"
                  placeholder="your@email.com"
                  value={nlEmail}
                  onChange={e => { setNlEmail(e.target.value); setNlError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSubscribe()}
                />
                <button className={s.nlBtn} onClick={handleSubscribe} disabled={nlLoading}>
                  {nlLoading ? 'Joining…' : 'Notify me →'}
                </button>
              </div>
            )}
            {nlError && (
              <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{nlError}</p>
            )}
            {!nlDone && (
              <div className={s.nlMeta}>
                <span>✓ No spam, ever</span>
                <span>✓ Unsubscribe anytime</span>
                <span>✓ Launching soon</span>
              </div>
            )}
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────── */}
        <section className={s.final}>
          <div className={s.floatingTags} aria-hidden="true">
            <span className={s.float} />
            <span className={s.float} />
            <span className={s.float} />
          </div>

          <div className={r()} data-reveal>
            <h2>Don't wait until it's gone.</h2>
            <p>
              TagGuard helps honest finders do the right thing —
              while keeping your private details protected.
            </p>
            <Link href="/app" className={`${s.btn} ${s.teal}`}>
              Get Started Free →
            </Link>
          </div>
        </section>

      </main>

      {/* ── Footer bar ───────────────────────────── */}
      <footer className={s.footerBar}>
        <span className={s.footerCopy}>
          © {new Date().getFullYear()} TagGuard · tagguard.in · All rights reserved
        </span>
        <SupportWidget
          label="Message customer care"
          variant="inline"
          context="landing_footer"
        />
      </footer>
    </div>
  )
}
