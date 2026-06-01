'use client'
/**
 * Owner's in-app chat view.
 * Identical chat/call functionality as the finder's /chat/[token],
 * but with app chrome (dark theme, back to /app).
 */
import { use } from 'react'
import { useRouter } from 'next/navigation'

export default function AppChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()

  // Render the same chat page in an iframe-like embed, or just redirect.
  // For now redirect to the shared chat page which handles both owner and finder roles.
  // The role is determined by comparing localStorage tg_phone with tag.owner_phone.
  if (typeof window !== 'undefined') {
    router.replace(`/chat/${token}`)
  }

  return (
    <main style={{ minHeight: '100dvh', background: '#07111f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '2px solid #334155', borderTopColor: '#185FA5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  )
}
