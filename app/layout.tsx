import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'QuickDesk',
  description: 'QuickDesk Web',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body {
            background: #f0f2f5 !important;
            color: #111111 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
          }
          a { color: inherit; text-decoration: none; }
          .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.15s; }
          .btn:hover { opacity: 0.85; }
          .btn:disabled { opacity: 0.4; cursor: not-allowed; }
          .btn-primary { background: #2563eb !important; color: #fff !important; }
          .btn-success { background: #16a34a !important; color: #fff !important; }
          .btn-danger  { background: #dc2626 !important; color: #fff !important; }
          .btn-ghost   { background: #e2e6ea !important; color: #333 !important; }
          input, select, textarea { background: #fff !important; border: 1px solid #d1d5db !important; color: #111 !important; border-radius: 5px; padding: 7px 10px; font-size: 13px; width: 100%; outline: none; }
          input:focus, select:focus, textarea:focus { border-color: #2563eb !important; }
          .card { background: #ffffff !important; border: 1px solid #e2e6ea !important; border-radius: 10px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
          .toast { position: fixed; bottom: 20px; right: 20px; background: #1e1e1e; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 9999; }
          @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
