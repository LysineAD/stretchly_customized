export default async function initializeBreakPresentation () {
  const [compact, initialClickThrough] = await Promise.all([
    window.settings.get('compactBreaks'),
    window.settings.get('breakClickThrough')
  ])
  const content = document.querySelector('.breaks')
  let clickThrough = initialClickThrough
  let lastIgnore = null
  let pointer = null
  const interactiveSelector = '#start, #postpone, #close, #finish, .break-idea a, .break-text a, .microbreak-idea a'

  const updateInput = () => {
    let interactive = false
    if (pointer) {
      const elements = [...document.querySelectorAll(interactiveSelector)]
      if (compact && content.scrollHeight > content.clientHeight + 1) elements.push(content)
      interactive = elements.some(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0 &&
          pointer.x >= bounds.left && pointer.x < bounds.right &&
          pointer.y >= bounds.top && pointer.y < bounds.bottom
      })
    }
    const ignore = clickThrough && !interactive
    if (ignore !== lastIgnore) {
      window.breaks.setClickThrough(ignore)
      lastIgnore = ignore
    }
  }

  if (compact) document.body.classList.add('compact-break')

  document.addEventListener('mousemove', event => {
    pointer = { x: event.clientX, y: event.clientY }
    updateInput()
  })
  document.addEventListener('mouseleave', async () => {
    pointer = await window.breaks.getPointerPosition()
    updateInput()
  })
  const observer = new window.MutationObserver(() => {
    updateInput()
  })
  observer.observe(content, { attributes: true, childList: true, characterData: true, subtree: true })
  window.breaks.onClickThroughChanged(enabled => {
    clickThrough = enabled
    lastIgnore = null
    updateInput()
  })
  updateInput()
}
