// QuickDesk Service Worker — Web Push — v4

// Force immediate activation and claim all open tabs/windows
self.addEventListener('install', function(event) {
  self.skipWaiting()
})
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', function(event) {
  if (!event.data) return
  let data = {}
  try { data = event.data.json() } catch(e) { data = { title: 'QuickDesk', body: event.data.text() } }
  const tag = data.tag || ('quickdesk-' + Date.now())
  event.waitUntil(
    self.registration.showNotification(data.title || 'QuickDesk', {
      body: data.body || '',
      tag: tag,
      renotify: true,
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const url = event.notification.data?.url || '/tasks'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
