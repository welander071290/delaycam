import { useEffect, useRef, useState } from 'react'
import './App.css'
import { registerServiceWorker } from './pwa'

type CameraStatus = 'idle' | 'connecting' | 'ready' | 'error'
type QualityPreset = 'max' | '1080p60' | '1080p30' | '720p60' | '720p30' | '480p30'

type BufferedFrame = {
  id: number
  capturedAt: number
  image: string
  size: number
}

const IS_ELECTRON = Boolean(window.delayCam)
const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
const IS_MOBILE = IS_IOS || /Android/i.test(navigator.userAgent)
const CAN_FULLSCREEN = Boolean(document.fullscreenEnabled)

const MAX_BUFFER_MS = 30_000
// Mobile browsers kill the page when it uses too much memory, so the frame buffer is capped there.
const MAX_BUFFER_BYTES = IS_MOBILE ? 220 * 1024 * 1024 : Number.POSITIVE_INFINITY
const DEFAULT_CAPTURE_WIDTH = 1920
const DEFAULT_CAPTURE_HEIGHT = 1080
const DEFAULT_CAPTURE_FPS = 60
const DEFAULT_QUALITY: QualityPreset = IS_MOBILE ? '720p30' : 'max'
const JPEG_QUALITY = IS_MOBILE ? 0.8 : 0.9
const QUALITY_PRESETS: Record<QualityPreset, { label: string; width: number; height: number; frameRate: number }> = {
  max: { label: 'MAX / Auto', width: DEFAULT_CAPTURE_WIDTH, height: DEFAULT_CAPTURE_HEIGHT, frameRate: DEFAULT_CAPTURE_FPS },
  '1080p60': { label: '1080p / 60 fps', width: 1920, height: 1080, frameRate: 60 },
  '1080p30': { label: '1080p / 30 fps', width: 1920, height: 1080, frameRate: 30 },
  '720p60': { label: '720p / 60 fps', width: 1280, height: 720, frameRate: 60 },
  '720p30': { label: '720p / 30 fps', width: 1280, height: 720, frameRate: 30 },
  '480p30': { label: '480p / 30 fps', width: 854, height: 480, frameRate: 30 },
}

function formatDelay(seconds: number) {
  return `${seconds.toString().padStart(2, '0')} s`
}

function releaseBufferedFrames(frames: BufferedFrame[]) {
  frames.forEach((frame) => URL.revokeObjectURL(frame.image))
}

function getCameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera permission was denied.'
    }

    if (error.name === 'NotFoundError') {
      return 'No camera was found.'
    }

    if (error.name === 'NotReadableError') {
      return 'The camera is already in use.'
    }
  }

  return 'The camera could not be opened.'
}

function App() {
  const sourceVideoRef = useRef<HTMLVideoElement>(null)
  const delayedCanvasRef = useRef<HTMLCanvasElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewShellRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureSettingsRef = useRef({
    width: DEFAULT_CAPTURE_WIDTH,
    height: DEFAULT_CAPTURE_HEIGHT,
    frameRate: DEFAULT_CAPTURE_FPS,
  })
  const frameBufferRef = useRef<BufferedFrame[]>([])
  const bufferBytesRef = useRef(0)
  const frameIdRef = useRef(0)
  const renderedFrameIdRef = useRef(-1)
  const renderTokenRef = useRef(0)
  const restartCameraRef = useRef<() => void>(() => undefined)

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle')
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>(DEFAULT_QUALITY)
  const [delaySeconds, setDelaySeconds] = useState(8)
  const [bufferSeconds, setBufferSeconds] = useState(0)
  const [bufferFrameRate, setBufferFrameRate] = useState(0)
  const [displayPaused, setDisplayPaused] = useState(false)
  const [cameraDetails, setCameraDetails] = useState('No camera connected')
  const [cameraError, setCameraError] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)

  const isCameraReady = cameraStatus === 'ready'

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const cameras = devices.filter((device) => device.kind === 'videoinput')
    setCameraDevices(cameras)
    setSelectedDeviceId((current) => current || cameras[0]?.deviceId || '')
  }

  function stopCamera(hideControls = true) {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    captureSettingsRef.current = {
      width: DEFAULT_CAPTURE_WIDTH,
      height: DEFAULT_CAPTURE_HEIGHT,
      frameRate: DEFAULT_CAPTURE_FPS,
    }
    releaseBufferedFrames(frameBufferRef.current)
    frameBufferRef.current = []
    bufferBytesRef.current = 0
    renderedFrameIdRef.current = -1
    setBufferSeconds(0)
    setBufferFrameRate(0)
    setCameraStatus('idle')
    setCameraDetails('No camera connected')

    if (hideControls) {
      setControlsVisible(false)
    }

    if (sourceVideoRef.current) {
      sourceVideoRef.current.srcObject = null
    }
  }

  async function startCamera(
    requestedQuality: QualityPreset = qualityPreset,
    keepControls = false,
    deviceId = selectedDeviceId,
  ) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        window.isSecureContext
          ? 'This browser does not support camera access.'
          : 'Camera access requires a secure (https) address.',
      )
      setCameraStatus('error')
      return
    }

    setCameraError('')
    setCameraStatus('connecting')
    stopCamera(!keepControls)
    setCameraStatus('connecting')

    try {
      const quality = QUALITY_PRESETS[requestedQuality]
      const videoConstraints: MediaTrackConstraints = {
        ...(deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'environment' } }),
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate, max: quality.frameRate },
      }

      if (requestedQuality !== 'max') {
        videoConstraints.width = { ideal: quality.width, max: quality.width }
        videoConstraints.height = { ideal: quality.height, max: quality.height }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      })

      streamRef.current = stream
      const videoTrack = stream.getVideoTracks()[0]
      const settings = videoTrack.getSettings()
      const width = settings.width ?? 0
      const height = settings.height ?? 0
      const frameRate = settings.frameRate ? Math.round(settings.frameRate) : 0
      captureSettingsRef.current = {
        width: width || DEFAULT_CAPTURE_WIDTH,
        height: height || DEFAULT_CAPTURE_HEIGHT,
        frameRate: frameRate || DEFAULT_CAPTURE_FPS,
      }
      setSelectedDeviceId(settings.deviceId ?? deviceId)

      if (sourceVideoRef.current) {
        sourceVideoRef.current.srcObject = stream
        await sourceVideoRef.current.play()
      }

      setCameraDetails(
        `${width} x ${height}${frameRate ? ` / ${frameRate} fps` : ''}`,
      )
      setCameraStatus('ready')
      await refreshDevices()
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setCameraError(getCameraError(error))
      setCameraStatus('error')
    }
  }

  async function toggleFullscreen() {
    if (!previewShellRef.current) {
      return
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await previewShellRef.current.requestFullscreen()
      }
    } catch {
      // Some mobile browsers refuse fullscreen for non-video elements.
    }
  }

  function closeApp() {
    if (window.delayCam) {
      window.delayCam.close()
      return
    }

    window.close()
  }

  function toggleControls() {
    setControlsVisible((visible) => !visible)
  }

  useEffect(() => {
    const initialScan = window.setTimeout(() => {
      void refreshDevices()
    }, 0)

    const handleDeviceChange = () => {
      void refreshDevices()
    }

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange)
    return () => {
      window.clearTimeout(initialScan)
      navigator.mediaDevices?.removeEventListener(
        'devicechange',
        handleDeviceChange,
      )
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    const previewCanvas = delayedCanvasRef.current
    const sourceVideo = sourceVideoRef.current

    if (!previewCanvas || !sourceVideo || !isCameraReady) {
      return
    }

    const captureWidth = sourceVideo.videoWidth || captureSettingsRef.current.width
    const captureHeight = sourceVideo.videoHeight || captureSettingsRef.current.height
    const captureFrameRate = Math.max(
      1,
      Math.min(
        DEFAULT_CAPTURE_FPS,
        captureSettingsRef.current.frameRate || DEFAULT_CAPTURE_FPS,
      ),
    )
    const sampleIntervalMs = 1000 / captureFrameRate

    previewCanvas.width = captureWidth
    previewCanvas.height = captureHeight
    const previewContext = previewCanvas.getContext('2d')

    if (!previewContext) {
      return
    }

    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = captureWidth
    captureCanvas.height = captureHeight
    captureCanvasRef.current = captureCanvas
    const captureContext = captureCanvas.getContext('2d')

    let animationFrame = 0
    let captureFrameCallback = 0
    let fallbackAnimationFrame = 0
    let lastCaptureAt = 0
    let lastBufferUpdateAt = 0
    let encodingFrame = false
    let isActive = true

    const captureFrame = (capturedAt: number) => {
      const frameWidth = sourceVideo.videoWidth
      const frameHeight = sourceVideo.videoHeight

      if (!captureContext || frameWidth <= 0 || frameHeight <= 0 || encodingFrame) {
        return
      }

      // Phones swap the video dimensions when they are rotated.
      if (captureCanvas.width !== frameWidth || captureCanvas.height !== frameHeight) {
        captureCanvas.width = frameWidth
        captureCanvas.height = frameHeight
      }

      encodingFrame = true
      captureContext.drawImage(sourceVideo, 0, 0, frameWidth, frameHeight)
      captureCanvas.toBlob(
        (blob) => {
          encodingFrame = false

          if (!blob || !isActive) {
            return
          }

          const frames = frameBufferRef.current
          frames.push({
            id: frameIdRef.current++,
            capturedAt,
            image: URL.createObjectURL(blob),
            size: blob.size,
          })
          bufferBytesRef.current += blob.size

          const oldestAllowed = capturedAt - MAX_BUFFER_MS
          let dropCount = 0
          while (
            dropCount < frames.length - 1 &&
            (frames[dropCount].capturedAt < oldestAllowed ||
              bufferBytesRef.current > MAX_BUFFER_BYTES)
          ) {
            URL.revokeObjectURL(frames[dropCount].image)
            bufferBytesRef.current -= frames[dropCount].size
            dropCount += 1
          }
          if (dropCount > 0) {
            frames.splice(0, dropCount)
          }

          if (capturedAt - lastBufferUpdateAt >= 500) {
            const firstFrame = frameBufferRef.current[0]
            const recentFrameCutoff = capturedAt - 1000
            const recentFrameCount = frameBufferRef.current.filter(
              (frame) => frame.capturedAt >= recentFrameCutoff,
            ).length
            setBufferSeconds(
              firstFrame
                ? Math.min(
                    MAX_BUFFER_MS / 1000,
                    (capturedAt - firstFrame.capturedAt) / 1000,
                  )
                : 0,
            )
            setBufferFrameRate(recentFrameCount)
            lastBufferUpdateAt = capturedAt
          }
        },
        'image/jpeg',
        JPEG_QUALITY,
      )
    }

    const scheduleCapture = () => {
      if (!isActive) {
        return
      }

      if ('requestVideoFrameCallback' in sourceVideo) {
        captureFrameCallback = sourceVideo.requestVideoFrameCallback(() => {
          if (!isActive) {
            return
          }

          captureFrame(performance.now())
          scheduleCapture()
        })
        return
      }

      fallbackAnimationFrame = requestAnimationFrame((now) => {
        if (!isActive) {
          return
        }

        if (now - lastCaptureAt >= sampleIntervalMs) {
          captureFrame(now)
          lastCaptureAt = now
        }

        scheduleCapture()
      })
    }

    const render = (now: number) => {

      if (!displayPaused) {
        const targetTime = now - delaySeconds * 1000
        let frameToRender: BufferedFrame | undefined

        for (let index = frameBufferRef.current.length - 1; index >= 0; index -= 1) {
          const frame = frameBufferRef.current[index]
          if (frame.capturedAt <= targetTime) {
            frameToRender = frame
            break
          }
        }

        if (frameToRender && frameToRender.id !== renderedFrameIdRef.current) {
          renderedFrameIdRef.current = frameToRender.id
          const renderToken = ++renderTokenRef.current
          const image = new Image()
          image.onload = () => {
            if (renderToken !== renderTokenRef.current) {
              return
            }

            if (
              previewCanvas.width !== image.naturalWidth ||
              previewCanvas.height !== image.naturalHeight
            ) {
              previewCanvas.width = image.naturalWidth
              previewCanvas.height = image.naturalHeight
            }

            previewContext.drawImage(image, 0, 0)
          }
          image.src = frameToRender.image
        }
      }

      animationFrame = requestAnimationFrame(render)
    }

    scheduleCapture()
    animationFrame = requestAnimationFrame(render)
    return () => {
      isActive = false
      cancelAnimationFrame(animationFrame)
      cancelAnimationFrame(fallbackAnimationFrame)
      if ('cancelVideoFrameCallback' in sourceVideo && captureFrameCallback) {
        sourceVideo.cancelVideoFrameCallback(captureFrameCallback)
      }
      captureCanvasRef.current = null
    }
  }, [delaySeconds, displayPaused, isCameraReady])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => registerServiceWorker(() => setUpdateReady(true)), [])

  useEffect(() => {
    restartCameraRef.current = () => void startCamera()
  })

  useEffect(() => {
    if (!isCameraReady) {
      return
    }

    // iOS stops the camera while the app is in the background; resume it when the user returns.
    const track = streamRef.current?.getVideoTracks()[0]
    const recover = () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      if (track?.readyState === 'ended') {
        restartCameraRef.current()
        return
      }

      const video = sourceVideoRef.current
      if (video?.paused) {
        void video.play().catch(() => undefined)
      }
    }

    track?.addEventListener('ended', recover)
    document.addEventListener('visibilitychange', recover)
    return () => {
      track?.removeEventListener('ended', recover)
      document.removeEventListener('visibilitychange', recover)
    }
  }, [isCameraReady])

  useEffect(() => {
    if (!isCameraReady || !('wakeLock' in navigator)) {
      return
    }

    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) {
        return
      }

      try {
        const nextLock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void nextLock.release()
        } else {
          lock = nextLock
        }
      } catch {
        // Wake lock is best effort; the camera keeps working without it.
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [isCameraReady])

  return (
    <div className="immersive-app">
      <main
        className="immersive-preview"
        ref={previewShellRef}
        onClick={toggleControls}
        aria-label="Delayed camera preview. Tap to show controls."
      >
        <video ref={sourceVideoRef} className="source-video" muted playsInline />
        <canvas
          ref={delayedCanvasRef}
          className={`delayed-canvas ${isCameraReady ? '' : 'is-hidden'}`}
          aria-label="Delayed camera feed"
        />

        {!isCameraReady && (
          <div className="preview-empty">
            <span className="empty-kicker">{IS_ELECTRON ? 'USB CAMERA INPUT' : 'CAMERA INPUT'}</span>
            <strong>{cameraStatus === 'error' ? 'Camera unavailable' : 'Ready when you are'}</strong>
            <p>{cameraError || 'Connect a camera to begin.'}</p>
            <button className="hud-button hud-button-primary" type="button" onClick={() => void startCamera()}>
              Start
            </button>
          </div>
        )}

        <div className="minimal-status" aria-live="polite">
          <span className={`status-orb status-orb-${cameraStatus}`} />
          {isCameraReady && <span>{formatDelay(delaySeconds)} behind</span>}
        </div>

        {updateReady && (
          <button
            className="update-banner"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              window.location.reload()
            }}
          >
            New version ready – tap to update
          </button>
        )}

        {controlsVisible && (
          <div className="control-hud" onClick={(event) => event.stopPropagation()}>
            <div className="hud-header">
              <div className="hud-brand">
                <img className="hud-mark hud-logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
                <div>
                  <span className="hud-kicker">DELAY CAM</span>
                  <strong>Spring replay</strong>
                </div>
              </div>
              <div className="hud-status">
                <span className={`status-orb status-orb-${cameraStatus}`} />
                <span>{cameraDetails}</span>
                <span className="hud-separator">/</span>
                <span>{bufferSeconds.toFixed(1)} s / {bufferFrameRate} fps buffered</span>
              </div>
            </div>

            <div className="hud-dock">
              <div className="hud-control hud-source-control">
                <label htmlFor="camera-select">Camera</label>
                <select
                  id="camera-select"
                  className="hud-select"
                  value={selectedDeviceId}
                  onChange={(event) => {
                    const nextDeviceId = event.target.value
                    setSelectedDeviceId(nextDeviceId)
                    if (isCameraReady) {
                      void startCamera(qualityPreset, true, nextDeviceId)
                    }
                  }}
                >
                  {cameraDevices.length === 0 && <option value="">Connect a camera</option>}
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Video input ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hud-control hud-delay-control">
                <div className="hud-control-heading">
                  <label htmlFor="delay-range">Playback delay</label>
                  <output htmlFor="delay-range">{formatDelay(delaySeconds)}</output>
                </div>
                <input
                  id="delay-range"
                  className="hud-range"
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={delaySeconds}
                  onChange={(event) => setDelaySeconds(Number(event.target.value))}
                />
                <div className="hud-range-labels"><span>LIVE</span><span>30 SEC</span></div>
              </div>

              <div className="hud-control hud-quality-control">
                <label htmlFor="quality-select">Capture quality</label>
                <select
                  id="quality-select"
                  className="hud-select"
                  value={qualityPreset}
                  onChange={(event) => {
                    const nextQuality = event.target.value as QualityPreset
                    setQualityPreset(nextQuality)
                    if (isCameraReady) {
                      void startCamera(nextQuality, true)
                    }
                  }}
                >
                  {Object.entries(QUALITY_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hud-actions">
                <button className="hud-button hud-button-primary" type="button" onClick={() => void startCamera()}>
                  {isCameraReady ? 'Reconnect' : 'Start camera'}
                </button>
                <button className="hud-button hud-button-secondary" type="button" onClick={() => setDisplayPaused((paused) => !paused)} disabled={!isCameraReady}>
                  {displayPaused ? 'Resume' : 'Freeze'}
                </button>
                <button className="hud-button hud-button-quiet" type="button" onClick={() => stopCamera()} disabled={!isCameraReady}>
                  Stop
                </button>
                {CAN_FULLSCREEN && (
                  <button className="hud-button hud-button-quiet" type="button" onClick={() => void toggleFullscreen()}>
                    {isFullscreen ? 'Exit full' : 'Full screen'}
                  </button>
                )}
                {IS_ELECTRON && (
                  <button className="hud-button hud-button-close" type="button" onClick={closeApp} aria-label="Close DelayCam">
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
