import type { Directive } from 'vue'

interface TiltHandlers {
  move: (event: PointerEvent) => void
  leave: () => void
}

const handlers = new WeakMap<HTMLElement, TiltHandlers>()

export const tiltDirective: Directive<HTMLElement> = {
  mounted(el) {
    el.classList.add('glass-tilt')
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width
      const y = (event.clientY - rect.top) / rect.height
      el.style.setProperty('--gx', (x * 100) + '%')
      el.style.setProperty('--gy', (y * 100) + '%')
      const rx = (y - 0.5) * -3.5
      const ry = (x - 0.5) * 4.5
      el.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)'
    }
    const leave = () => {
      el.style.transform = ''
    }
    el.addEventListener('pointermove', move, { passive: true })
    el.addEventListener('pointerleave', leave, { passive: true })
    handlers.set(el, { move, leave })
  },
  unmounted(el) {
    const handler = handlers.get(el)
    if (handler) {
      el.removeEventListener('pointermove', handler.move)
      el.removeEventListener('pointerleave', handler.leave)
      handlers.delete(el)
    }
  }
}

