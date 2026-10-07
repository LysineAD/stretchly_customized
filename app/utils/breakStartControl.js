export default function createBreakStartControl () {
  const button = document.querySelector('#start')
  const hint = document.querySelector('#start-hint')
  let started = null
  let deadline = null
  let lastSecond = null
  const updateHint = async () => {
    if (started !== null || !deadline) return
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (seconds === lastSecond) return
    lastSecond = seconds
    const text = await window.i18next.t('break.autoStartIn', { seconds })
    if (started === null) hint.textContent = text
  }
  const showState = () => {
    button.classList.toggle('hidden', started !== null)
    hint.classList.toggle('hidden', started !== null)
    updateHint()
  }
  window.breaks.onStartDeadline(time => {
    deadline = time
    updateHint()
  })
  window.breaks.onCountdownStarted(time => {
    started = time
    showState()
  })
  button.onclick = async () => {
    const time = await window.breaks.startBreak()
    if (time !== null) {
      started = time
      showState()
    }
  }
  window.setInterval(updateHint, 500)
  return {
    initialize (time, autoStartAt) {
      if (started === null) started = time
      if (autoStartAt) deadline = autoStartAt
      showState()
    },
    get started () { return started }
  }
}
