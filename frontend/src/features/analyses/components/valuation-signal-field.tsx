import { useEffect, useRef } from 'react'

type Signal = {
  phase: number
  angle: number
  lifetime: number
  depth: number
  radius: number
  opacity: number
  color: string
  stretch: number
  shiftX: number
  shiftY: number
  velocityX: number
  velocityY: number
}

const SIGNAL_COLORS = ['70, 114, 137', '77, 116, 128', '96, 124, 139', '67, 128, 133']
const TAU = Math.PI * 2

function createSignals(count: number): Signal[] {
  let seed = 41357
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }

  return Array.from({ length: count }, () => {
    const depth = random()
    return {
      phase: 1 - Math.sqrt(random()),
      angle: random() * TAU,
      lifetime: 155 + random() * 120,
      depth,
      radius: 0.55 + depth * depth * 1.15,
      opacity: 0.24 + depth * 0.38,
      color: SIGNAL_COLORS[Math.floor(random() * SIGNAL_COLORS.length)],
      stretch: 0.89 + random() * 0.22,
      shiftX: 0,
      shiftY: 0,
      velocityX: 0,
      velocityY: 0,
    }
  })
}

function smoothStep(start: number, end: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return amount * amount * (3 - 2 * amount)
}

export function ValuationSignalField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    let width = 0
    let height = 0
    let left = 0
    let top = 0
    let elapsed = 0
    let previousFrame = 0
    let frame: number | null = null
    let inView = true
    let signals: Signal[] = []
    let disposed = false
    const pointer = { x: 0, y: 0, active: false }

    const draw = (delta: number) => {
      context.clearRect(0, 0, width, height)
      const centerX = width * 0.5
      const centerY = height * 0.48
      const quietWidth = Math.min(310, width * 0.415)
      const quietHeight = width < 640 ? 102 : 96
      const orbitWidth = width * 0.49
      const orbitHeight = height * 0.58
      const interactionRadius = 132

      for (const signal of signals) {
        const cycle = (signal.phase + elapsed / signal.lifetime) % 1
        const distance = 0.18 + signal.depth * 0.08 + 1.2 * (1 - cycle) ** 0.8
        const angle = signal.angle + elapsed * (0.007 + signal.depth * 0.009) + cycle * 0.5
        const sway = Math.sin(elapsed * 0.09 + signal.angle * 3) * 4 * signal.depth
        const x = centerX + Math.cos(angle) * orbitWidth * distance * signal.stretch + sway
        const y = centerY + Math.sin(angle) * orbitHeight * distance / signal.stretch
        let targetX = 0
        let targetY = 0

        if (pointer.active && !reducedMotion.matches) {
          const dx = x - pointer.x
          const dy = y - pointer.y
          const separation = Math.hypot(dx, dy)
          if (separation < interactionRadius && separation > 0) {
            const force = (1 - separation / interactionRadius) ** 2 * (10 + signal.depth * 13)
            targetX = dx / separation * force
            targetY = dy / separation * force
          }
        }

        if (delta > 0) {
          const damping = Math.exp(-7 * delta)
          signal.velocityX = (signal.velocityX + (targetX - signal.shiftX) * 26 * delta) * damping
          signal.velocityY = (signal.velocityY + (targetY - signal.shiftY) * 26 * delta) * damping
          signal.shiftX += signal.velocityX * delta
          signal.shiftY += signal.velocityY * delta
        }

        const drawX = x + signal.shiftX
        const drawY = y + signal.shiftY
        if (drawX < -3 || drawX > width + 3 || drawY < -3 || drawY > height + 3) continue

        const quietDistance = ((Math.abs(drawX - centerX) / quietWidth) ** 4
          + (Math.abs(drawY - centerY) / quietHeight) ** 4) ** 0.25
        const centerFade = smoothStep(0.92, 1.55, quietDistance)
        const cycleFade = smoothStep(0, 0.06, cycle) * (1 - smoothStep(0.89, 1, cycle))
        const opacity = signal.opacity * centerFade * cycleFade
        if (opacity < 0.008) continue

        context.beginPath()
        context.fillStyle = `rgba(${signal.color}, ${opacity})`
        context.arc(drawX, drawY, signal.radius, 0, TAU)
        context.fill()
      }
    }

    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = null
      previousFrame = 0
    }

    const animate = (timestamp: number) => {
      frame = null
      if (disposed || document.hidden || !inView || reducedMotion.matches) return
      const delta = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.05) : 0
      previousFrame = timestamp
      elapsed += delta
      draw(delta)
      frame = window.requestAnimationFrame(animate)
    }

    const syncAnimation = () => {
      stop()
      if (disposed || document.hidden || !inView || width === 0 || height === 0) return
      if (reducedMotion.matches) {
        for (const signal of signals) {
          signal.shiftX = 0
          signal.shiftY = 0
          signal.velocityX = 0
          signal.velocityY = 0
        }
        draw(0)
      } else {
        frame = window.requestAnimationFrame(animate)
      }
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      left = bounds.left
      top = bounds.top
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      const count = Math.min(580, Math.max(230, Math.round(width * height / 2000)))
      if (signals.length !== count) signals = createSignals(count)
      draw(0)
      syncAnimation()
    }

    const movePointer = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType !== 'mouse' || reducedMotion.matches) return
      pointer.x = event.clientX - left
      pointer.y = event.clientY - top
      pointer.active = pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height
    }
    const clearPointer = () => { pointer.active = false }
    const leaveWindow = (event: PointerEvent) => {
      if (!event.relatedTarget) clearPointer()
    }
    const changeMotion = () => {
      clearPointer()
      syncAnimation()
    }

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    const intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => {
          inView = entry.isIntersecting
          syncAnimation()
        })
      : null

    resizeObserver?.observe(canvas)
    intersectionObserver?.observe(canvas)
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', movePointer, { passive: true })
    window.addEventListener('pointerout', leaveWindow, { passive: true })
    window.addEventListener('pointercancel', clearPointer, { passive: true })
    window.addEventListener('blur', clearPointer)
    document.addEventListener('visibilitychange', syncAnimation)
    reducedMotion.addEventListener('change', changeMotion)
    finePointer.addEventListener('change', clearPointer)
    resize()

    return () => {
      disposed = true
      stop()
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', movePointer)
      window.removeEventListener('pointerout', leaveWindow)
      window.removeEventListener('pointercancel', clearPointer)
      window.removeEventListener('blur', clearPointer)
      document.removeEventListener('visibilitychange', syncAnimation)
      reducedMotion.removeEventListener('change', changeMotion)
      finePointer.removeEventListener('change', clearPointer)
    }
  }, [])

  return <canvas ref={canvasRef} className="valuation-signal-field" aria-hidden="true"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
