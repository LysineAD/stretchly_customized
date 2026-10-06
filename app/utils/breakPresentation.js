export default async function initializeBreakPresentation () {
  const [compact, initialClickThrough] = await Promise.all([
    window.settings.get('compactBreaks'),
    window.settings.get('breakClickThrough')
  ])
  const content = document.querySelector('.breaks')
  let clickThrough = initialClickThrough
  let lastIgnore = null
  let pointer = null
  let lastHeight = null
  let lastWidth = null
  const interactiveSelector = '#postpone, #close, #finish, .break-idea a, .break-text a, .microbreak-idea a'

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

  const resize = () => {
    if (!compact) return
    const height = Math.ceil(content.scrollHeight)
    if (height !== lastHeight || content.clientWidth !== lastWidth) {
      lastHeight = height
      lastWidth = content.clientWidth
      window.breaks.resizeWindow(height)
    }
  }

  if (compact) {
    document.body.classList.add('compact-break')
    await document.fonts.ready
    await window.breaks.resizeWindow(Math.ceil(content.scrollHeight))
    lastHeight = Math.ceil(content.scrollHeight)
    lastWidth = content.clientWidth
    const resizeObserver = new window.ResizeObserver(resize)
    resizeObserver.observe(content)
  }

  document.addEventListener('mousemove', event => {
    pointer = { x: event.clientX, y: event.clientY }
    updateInput()
  })
  document.addEventListener('mouseleave', async () => {
    pointer = await window.breaks.getPointerPosition()
    updateInput()
  })
  const observer = new window.MutationObserver(() => {
    resize()
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
