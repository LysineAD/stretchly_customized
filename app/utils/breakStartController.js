export default class BreakStartController {
  constructor () {
    this.session = null
  }

  wait (type, windows, onStart, delay = 0, deadline = null) {
    this.clear()
    this.session = { type, windows, onStart, started: null, deadline: delay > 0 ? deadline : null, delay, timer: null, armed: false, pausedAt: null }
    return this.session
  }

  arm () {
    const session = this.session
    if (!session || session.armed || session.started !== null || session.pausedAt !== null) return
    session.armed = true
    if (session.delay > 0) {
      session.deadline ??= Date.now() + session.delay
      session.timer = setTimeout(() => {
        if (this.session === session) this.start()
      }, Math.max(0, session.deadline - Date.now()))
    }
    for (const window of session.windows) {
      if (!window.isDestroyed()) window.webContents.send('break-start-deadline', session.deadline)
    }
  }

  start (type, sender) {
    const session = this.session
    if (!session || session.started !== null || session.pausedAt !== null || (type && type !== session.type)) return null
    if (sender && !session.windows.some(window => !window.isDestroyed() && window.webContents === sender)) return null
    clearTimeout(session.timer)
    session.timer = null
    session.started = Date.now()
    session.onStart()
    for (const window of session.windows) {
      if (!window.isDestroyed()) window.webContents.send('break-countdown-started', session.started)
    }
    return session.started
  }

  pause () {
    const session = this.session
    if (!session || session.started !== null || session.pausedAt !== null) return
    session.pausedAt = Date.now()
    clearTimeout(session.timer)
    session.armed = false
  }

  resume () {
    const session = this.session
    if (!session || session.pausedAt === null) return
    if (session.deadline !== null) session.deadline += Date.now() - session.pausedAt
    session.pausedAt = null
    this.arm()
  }

  clear () {
    if (this.session) clearTimeout(this.session.timer)
    this.session = null
  }

  close (windows) {
    if (this.session?.windows === windows) this.clear()
  }
}
