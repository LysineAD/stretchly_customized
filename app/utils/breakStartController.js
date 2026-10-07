export default class BreakStartController {
  constructor (globalShortcut) {
    this.globalShortcut = globalShortcut
    this.shortcut = ''
    this.session = null
  }

  conflicts (shortcut, settings, platform = process.platform) {
    if (typeof shortcut !== 'string') return true
    const normalize = value => value.toLowerCase()
      .replace(/cmdorctrl|commandorcontrol/g, platform === 'darwin' ? 'cmd' : 'ctrl')
      .replace(/command|control|option/g, key => ({ command: 'cmd', control: 'ctrl', option: 'alt' })[key])
      .split('+').map(key => key.trim()).sort().join('+')
    return shortcut.trim() !== '' && Object.entries(settings).some(([key, value]) =>
      key !== 'startBreakShortcut' && key.endsWith('Shortcut') && typeof value === 'string' &&
      normalize(value) === normalize(shortcut))
  }

  configure (shortcut, enabled) {
    if (typeof shortcut !== 'string') return false
    const candidate = enabled ? shortcut.trim() : ''
    if (candidate === this.shortcut && (!candidate || this.globalShortcut.isRegistered(candidate))) return true
    if (candidate) {
      try {
        if (!this.globalShortcut.register(candidate, () => this.start())) return false
      } catch {
        return false
      }
    }
    if (this.shortcut && this.shortcut !== candidate) this.globalShortcut.unregister(this.shortcut)
    this.shortcut = candidate
    return true
  }

  wait (type, windows, onStart) {
    this.session = { type, windows, onStart, started: null }
    return this.session
  }

  start (type, sender) {
    const session = this.session
    if (!session || session.started !== null || (type && type !== session.type)) return null
    if (sender && !session.windows.some(window => !window.isDestroyed() && window.webContents === sender)) return null
    session.started = Date.now()
    session.onStart()
    for (const window of session.windows) {
      if (!window.isDestroyed()) window.webContents.send('break-countdown-started', session.started)
    }
    return session.started
  }

  close (windows) {
    if (this.session?.windows === windows) this.session = null
  }
}
