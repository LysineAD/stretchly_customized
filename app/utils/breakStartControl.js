export default function createBreakStartControl () {
  const button = document.querySelector('#start')
  const hint = document.querySelector('#start-hint')
  let started = null
  const showState = () => {
    button.classList.toggle('hidden', started !== null)
    hint.classList.toggle('hidden', started !== null)
  }
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
  return {
    initialize (time) {
      if (started === null) started = time
      showState()
    },
    get started () { return started }
  }
}
