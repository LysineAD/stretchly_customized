export default class BreakActionShortcut {
  constructor (globalShortcut) {
    this.globalShortcut = globalShortcut
    this.shortcut = ''
    this.action = null
  }

  configure (shortcut, action = this.action) {
    if (typeof shortcut !== 'string') return false
    const candidate = shortcut.trim()
    if (candidate === this.shortcut && candidate && this.globalShortcut.isRegistered(candidate)) return true
    if (candidate) {
      try {
        if (!this.globalShortcut.register(candidate, action || (() => {}))) return false
      } catch {
        return false
      }
      if (!action) this.globalShortcut.unregister(candidate)
    }
    if (this.shortcut && this.shortcut !== candidate) this.globalShortcut.unregister(this.shortcut)
    this.shortcut = action ? candidate : ''
    this.action = action
    return true
  }

  clear () {
    if (this.shortcut) this.globalShortcut.unregister(this.shortcut)
    this.shortcut = ''
    this.action = null
  }
}
