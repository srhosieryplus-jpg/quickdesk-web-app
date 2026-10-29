import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QuickDesk',
  description: 'QuickDesk Web',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
            background: #f0f2f5;
            color: #111;
            font-size: 14px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; font-family: 'Inter', sans-serif; transition: opacity 0.15s; }
          .btn:hover { opacity: 0.85; }
          .btn:disabled { opacity: 0.4; cursor: not-allowed; }
          .btn-primary { background: #2563eb !important; color: #fff !important; }
          .btn-ghost   { background: #e2e6ea !important; color: #333 !important; }
          input, select, textarea {
            font-family: 'Inter', sans-serif !important;
            background: #fff; border: 1px solid #d1d5db; color: #111;
            border-radius: 5px; padding: 7px 10px; font-size: 13px; width: 100%; outline: none;
          }
          input:focus, select:focus, textarea:focus { border-color: #7c3aed; }
          .toast { position: fixed; bottom: 20px; right: 20px; background: #1e1e1e; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 9999; font-family: 'Inter', sans-serif; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
