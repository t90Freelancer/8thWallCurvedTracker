const TASKS_VERSION = '0.10.35'
const TASKS_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'

const xrCanvas = document.getElementById('xr-canvas')
const effectCanvas = document.getElementById('effect-canvas')
const startButton = document.getElementById('start-button')
const smoothSlider = document.getElementById('smooth-slider')
const statusEl = document.getElementById('status')
const statusText = document.getElementById('status-text')
const cameraButtons = [...document.querySelectorAll('[data-camera]')]

const frameCanvas = document.createElement('canvas')
const frameCtx = frameCanvas.getContext('2d', {willReadFrequently: true})
const effectCtx = effectCanvas.getContext('2d')

const HOLD_MS = 520
const INFERENCE_INTERVAL_MS = 66
const MIN_VISIBLE_LANDMARKS = 9
const TAU = Math.PI * 2

let poseLandmarker = null
let poseReady = false
let xrStarted = false
let modulesAdded = false
let inferenceBusy = false
let lastInferenceAt = 0
let lastFrameShape = {cols: 1, rows: 1}
let cameraFacing = 'back'
let animationStarted = false
let smoothedBox = null
let targetBox = null
let landmarksForDraw = []
let lastSeenAt = 0
let bootError = ''

const stateLabel = {
  loading: 'Dang tai',
  ready: 'San sang',
  starting: 'Dang mo camera',
  scanning: 'Dang tim nguoi',
  found: 'Da thay nguoi',
  lost: 'Mat tracking',
  error: 'Loi',
}

const landmarkGroups = {
  shoulders: [11, 12],
  hips: [23, 24],
  knees: [25, 26],
  ankles: [27, 28],
  wrists: [15, 16],
}

const setStatus = (state, detail = '') => {
  statusEl.dataset.state = state
  statusText.textContent = detail ? `${stateLabel[state] || state}: ${detail}` : stateLabel[state] || state
}

const waitForXR8 = () => new Promise((resolve, reject) => {
  if (window.XR8) {
    resolve(window.XR8)
    return
  }

  const timeout = window.setTimeout(() => {
    reject(new Error('8th Wall script did not load'))
  }, 10000)

  window.addEventListener('xrloaded', () => {
    window.clearTimeout(timeout)
    resolve(window.XR8)
  }, {once: true})
})

const resizeCanvases = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = window.innerWidth
  const height = window.innerHeight

  ;[xrCanvas, effectCanvas].forEach((canvas) => {
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  })

  effectCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const getSmoothAlpha = () => {
  const smooth = Number(smoothSlider.value) / 100

  return 0.42 - smooth * 0.32
}

const lerp = (a, b, t) => a + (b - a) * t

const smoothBox = (box) => {
  if (!smoothedBox) {
    smoothedBox = {...box}
    return smoothedBox
  }

  const alpha = getSmoothAlpha()
  const dx = box.cx - smoothedBox.cx
  const dy = box.cy - smoothedBox.cy
  const speed = Math.hypot(dx, dy)
  const adaptive = Math.min(0.56, alpha + speed / 900)
  const deadband = 1.2

  Object.keys(box).forEach((key) => {
    const delta = box[key] - smoothedBox[key]

    if (Math.abs(delta) > deadband || key === 'confidence') {
      smoothedBox[key] = lerp(smoothedBox[key], box[key], adaptive)
    }
  })

  return smoothedBox
}

const screenPoint = (landmark) => {
  const viewWidth = window.innerWidth
  const viewHeight = window.innerHeight
  const sourceAspect = lastFrameShape.cols / lastFrameShape.rows
  const viewAspect = viewWidth / viewHeight
  let drawWidth = viewWidth
  let drawHeight = viewHeight
  let offsetX = 0
  let offsetY = 0

  if (viewAspect > sourceAspect) {
    drawHeight = viewWidth / sourceAspect
    offsetY = (viewHeight - drawHeight) / 2
  } else {
    drawWidth = viewHeight * sourceAspect
    offsetX = (viewWidth - drawWidth) / 2
  }

  const x = cameraFacing === 'front' ? 1 - landmark.x : landmark.x

  return {
    x: offsetX + x * drawWidth,
    y: offsetY + landmark.y * drawHeight,
    visibility: landmark.visibility ?? landmark.presence ?? 1,
  }
}

const averagePoint = (points) => {
  const visible = points.filter(point => point && point.visibility > 0.35)

  if (!visible.length) {
    return null
  }

  return {
    x: visible.reduce((sum, point) => sum + point.x, 0) / visible.length,
    y: visible.reduce((sum, point) => sum + point.y, 0) / visible.length,
  }
}

const estimateBodyBox = (landmarks) => {
  const points = landmarks
    .map(screenPoint)
    .filter(point => point.visibility > 0.34)

  if (points.length < MIN_VISIBLE_LANDMARKS) {
    return null
  }

  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  const width = Math.max(80, right - left)
  const height = Math.max(160, bottom - top)
  const shoulders = averagePoint(landmarkGroups.shoulders.map(index => points[index]))
  const hips = averagePoint(landmarkGroups.hips.map(index => points[index]))
  const centerX = shoulders && hips ? (shoulders.x + hips.x) / 2 : left + width / 2
  const centerY = shoulders && hips ? (shoulders.y + hips.y) / 2 : top + height / 2

  return {
    cx: centerX,
    cy: centerY,
    left: left - width * 0.16,
    top: top - height * 0.12,
    right: right + width * 0.16,
    bottom: bottom + height * 0.12,
    width: width * 1.32,
    height: height * 1.24,
    confidence: points.length / 33,
  }
}

const copyFrameToCanvas = ({pixels, rows, cols, rowBytes}) => {
  if (!pixels || !rows || !cols) {
    return false
  }

  if (frameCanvas.width !== cols || frameCanvas.height !== rows) {
    frameCanvas.width = cols
    frameCanvas.height = rows
  }

  lastFrameShape = {cols, rows}

  const source = pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels)
  const imageData = frameCtx.createImageData(cols, rows)
  const out = imageData.data
  const rgbaRowBytes = cols * 4

  if (!rowBytes || rowBytes === rgbaRowBytes) {
    out.set(source.subarray(0, out.length))
  } else if (rowBytes >= cols * 3) {
    for (let row = 0; row < rows; row += 1) {
      let src = row * rowBytes
      let dst = row * rgbaRowBytes

      for (let col = 0; col < cols; col += 1) {
        out[dst] = source[src]
        out[dst + 1] = source[src + 1]
        out[dst + 2] = source[src + 2]
        out[dst + 3] = 255
        src += 3
        dst += 4
      }
    }
  } else {
    for (let row = 0; row < rows; row += 1) {
      let src = row * rowBytes
      let dst = row * rgbaRowBytes

      for (let col = 0; col < cols; col += 1) {
        const value = source[src]
        out[dst] = value
        out[dst + 1] = value
        out[dst + 2] = value
        out[dst + 3] = 255
        src += 1
        dst += 4
      }
    }
  }

  frameCtx.putImageData(imageData, 0, 0)
  return true
}

const processPoseFrame = async (frame) => {
  if (!poseReady || inferenceBusy) {
    return
  }

  const now = performance.now()

  if (now - lastInferenceAt < INFERENCE_INTERVAL_MS) {
    return
  }

  inferenceBusy = true
  lastInferenceAt = now

  try {
    if (!copyFrameToCanvas(frame)) {
      return
    }

    const result = poseLandmarker.detectForVideo(frameCanvas, now)
    const landmarks = result.landmarks?.[0]

    if (!landmarks) {
      return
    }

    const box = estimateBodyBox(landmarks)

    if (!box) {
      return
    }

    targetBox = box
    landmarksForDraw = landmarks.map(screenPoint)
    lastSeenAt = now
    setStatus('found')
  } catch (error) {
    bootError = error.message || String(error)
    setStatus('error', bootError)
  } finally {
    inferenceBusy = false
  }
}

const createPoseLandmarker = async () => {
  const {FilesetResolver, PoseLandmarker} = await import(`${TASKS_URL}/vision_bundle.mjs`)
  const vision = await FilesetResolver.forVisionTasks(`${TASKS_URL}/wasm`)
  const options = delegate => ({
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.52,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.58,
  })

  try {
    return await PoseLandmarker.createFromOptions(vision, options('GPU'))
  } catch (error) {
    return PoseLandmarker.createFromOptions(vision, options('CPU'))
  }
}

const personPipelineModule = () => ({
  name: 'person-pose-pipeline',
  onStart: () => {
    setStatus('scanning')
  },
  onCameraStatusChange: ({status}) => {
    if (status === 'requesting') {
      setStatus('starting')
    } else if (status === 'hasStream') {
      setStatus('scanning')
    } else if (status === 'failed') {
      setStatus('error', 'Camera')
    }
  },
  onProcessCpu: ({processGpuResult}) => {
    const frame = processGpuResult?.camerapixelarray

    if (frame) {
      processPoseFrame(frame)
    }
  },
})

const ensureXRModules = () => {
  if (modulesAdded) {
    return
  }

  if (!window.XR8?.CameraPixelArray) {
    throw new Error('CameraPixelArray is not available')
  }

  window.XR8.addCameraPipelineModules([
    window.XR8.GlTextureRenderer.pipelineModule(),
    window.XR8.XrController.pipelineModule(),
    window.XR8.CameraPixelArray.pipelineModule({
      luminance: false,
      maxDimension: 384,
    }),
    personPipelineModule(),
  ])

  modulesAdded = true
}

const getCameraDirection = () => {
  const cameraConfig = window.XR8?.XrConfig?.camera?.()

  if (!cameraConfig) {
    return cameraFacing
  }

  return cameraFacing === 'front'
    ? cameraConfig.FRONT || 'front'
    : cameraConfig.BACK || 'back'
}

const startXR = async () => {
  if (xrStarted) {
    return
  }

  setStatus('loading')
  startButton.disabled = true

  try {
    await waitForXR8()

    if (!poseLandmarker) {
      poseLandmarker = await createPoseLandmarker()
      poseReady = true
    }

    ensureXRModules()

    window.XR8.XrController.configure({
      disableWorldTracking: true,
      enableLighting: false,
    })

    window.XR8.run({
      canvas: xrCanvas,
      allowedDevices: window.XR8.XrConfig.device().ANY,
      cameraConfig: {
        direction: getCameraDirection(),
      },
      glContextConfig: {
        alpha: false,
        preserveDrawingBuffer: false,
      },
    })

    xrStarted = true
    startButton.querySelector('span:last-child').textContent = 'Running'
    setStatus('scanning')
  } catch (error) {
    startButton.disabled = false
    bootError = error.message || String(error)
    setStatus('error', bootError)
  }
}

const restartXR = async () => {
  if (!xrStarted) {
    return
  }

  setStatus('starting')
  targetBox = null
  smoothedBox = null
  landmarksForDraw = []

  try {
    window.XR8.stop()
    xrStarted = false
    window.setTimeout(() => {
      startXR()
    }, 180)
  } catch (error) {
    setStatus('error', error.message || String(error))
  }
}

const drawBodyRing = (ctx, box, opacity, time) => {
  const rx = Math.max(92, box.width * 0.56)
  const ry = Math.max(150, box.height * 0.54)
  const tilt = Math.sin(time * 0.0013) * 0.035
  const pulse = 1 + Math.sin(time * 0.004) * 0.018

  ctx.save()
  ctx.translate(box.cx, box.cy)
  ctx.rotate(tilt)
  ctx.scale(pulse, 1)

  const glow = ctx.createRadialGradient(0, 0, Math.max(12, rx * 0.22), 0, 0, rx)
  glow.addColorStop(0, `rgba(77, 225, 255, ${0.02 * opacity})`)
  glow.addColorStop(0.62, `rgba(77, 225, 255, ${0.08 * opacity})`)
  glow.addColorStop(1, `rgba(255, 216, 77, ${0.03 * opacity})`)
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(0, 0, rx * 1.08, ry * 1.04, 0, 0, TAU)
  ctx.fill()

  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i += 1) {
    const offset = i * 0.18
    const start = (time * 0.0011 + offset) % TAU
    const end = start + Math.PI * (0.78 - i * 0.1)
    ctx.lineWidth = 3 - i * 0.65
    ctx.strokeStyle = i === 1
      ? `rgba(255, 216, 77, ${0.58 * opacity})`
      : `rgba(77, 225, 255, ${0.5 * opacity})`
    ctx.beginPath()
    ctx.ellipse(0, 0, rx * (1 + i * 0.09), ry * (1 + i * 0.055), 0, start, end)
    ctx.stroke()
  }

  ctx.restore()
}

const drawOrbitParticles = (ctx, box, opacity, time) => {
  const rx = Math.max(92, box.width * 0.6)
  const ry = Math.max(150, box.height * 0.56)

  ctx.save()
  for (let i = 0; i < 32; i += 1) {
    const phase = i / 32
    const angle = phase * TAU + time * 0.0015
    const wave = Math.sin(time * 0.002 + i * 1.7)
    const x = box.cx + Math.cos(angle) * rx
    const y = box.cy + Math.sin(angle) * ry * 0.98
    const size = 1.4 + (wave + 1) * 1.4
    const alpha = (0.2 + Math.max(0, wave) * 0.5) * opacity

    ctx.fillStyle = i % 3 === 0
      ? `rgba(255, 216, 77, ${alpha})`
      : `rgba(77, 225, 255, ${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, size, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

const drawJointAccents = (ctx, opacity) => {
  const indexes = [
    ...landmarkGroups.shoulders,
    ...landmarkGroups.hips,
    ...landmarkGroups.wrists,
    ...landmarkGroups.knees,
    ...landmarkGroups.ankles,
  ]

  ctx.save()
  indexes.forEach((index) => {
    const point = landmarksForDraw[index]

    if (!point || point.visibility < 0.45) {
      return
    }

    ctx.lineWidth = 1.3
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.26 * opacity})`
    ctx.fillStyle = `rgba(77, 225, 255, ${0.5 * opacity})`
    ctx.beginPath()
    ctx.arc(point.x, point.y, 8, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(point.x, point.y, 2.4, 0, TAU)
    ctx.fill()
  })
  ctx.restore()
}

const draw = (time = performance.now()) => {
  const width = window.innerWidth
  const height = window.innerHeight

  effectCtx.clearRect(0, 0, width, height)

  if (targetBox) {
    const age = performance.now() - lastSeenAt
    const opacity = Math.max(0, Math.min(1, 1 - age / HOLD_MS))

    if (age < HOLD_MS) {
      const box = smoothBox(targetBox)
      drawBodyRing(effectCtx, box, opacity, time)
      drawOrbitParticles(effectCtx, box, opacity, time)
      drawJointAccents(effectCtx, opacity)
    } else {
      targetBox = null
      landmarksForDraw = []
      setStatus(bootError ? 'error' : 'lost')
    }
  }

  window.requestAnimationFrame(draw)
}

const setCameraFacing = (facing) => {
  cameraFacing = facing
  cameraButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.camera === facing)
  })
  restartXR()
}

window.addEventListener('resize', resizeCanvases)
startButton.addEventListener('click', startXR)
cameraButtons.forEach((button) => {
  button.addEventListener('click', () => setCameraFacing(button.dataset.camera))
})

resizeCanvases()
setStatus('ready')

if (!animationStarted) {
  animationStarted = true
  draw()
}
