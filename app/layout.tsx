import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QuickDesk',
  description: 'QuickDesk Web',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background:'#f0f2f5' }}>
      <head>
        <meta name="color-scheme" content="light" />
        <style>{`
          :root { color-scheme: light !important; }
          body { background: #f0f2f5 !important; color: #111 !important; }
        `}</style>
      </head>
      <body style={{ background:'#f0f2f5', color:'#111' }}>{children}</body>
    </html>
  )
}
