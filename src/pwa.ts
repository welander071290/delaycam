// Registers the offline service worker for the web/iOS build. Electron loads from file:// and skips it.
export function registerServiceWorker(onUpdateReady: () => void) {
  if (
    !import.meta.env.PROD ||
    window.delayCam ||
    !('serviceWorker' in navigator) ||
    !window.location.protocol.startsWith('http')
  ) {
    return undefined
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'update-ready') {
      onUpdateReady()
    }
  }

  navigator.serviceWorker.addEventListener('message', handleMessage)
  navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: 'check-update' }))
    .catch(() => undefined)

  return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
}
