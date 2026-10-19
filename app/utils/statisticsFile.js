import { readFile, writeFile, rename, copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const maximumBytes = 3 * 1024 * 1024

export default class StatisticsFile {
  constructor (path, onError = () => {}) {
    this.path = path
    this.onError = onError
    this.queue = Promise.resolve()
    this.timer = null
    this.pending = null
    this.mainValid = false
  }

  async load () {
    for (const path of [this.path, this.path + '.bak']) {
      try {
        const text = await readFile(path, 'utf8')
        if (Buffer.byteLength(text) > maximumBytes) continue
        const data = JSON.parse(text)
        if (data?.version === 1 && data.days && typeof data.days === 'object' && data.lifetime) {
          this.mainValid = path === this.path
          return data
        }
      } catch (error) {
        if (error.code !== 'ENOENT') this.onError(error)
      }
    }
    return {}
  }

  schedule (serialize) {
    this.pending = serialize
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 5000)
    this.timer.unref?.()
  }

  flush () {
    clearTimeout(this.timer)
    this.timer = null
    const serialize = this.pending
    this.pending = null
    if (!serialize) return this.queue
    const text = serialize()
    if (Buffer.byteLength(text) > maximumBytes) {
      this.onError(new Error('Statistics storage limit reached'))
      return this.queue
    }
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(this.path + '.tmp', text, { encoding: 'utf8', mode: 0o600 })
      if (this.mainValid) {
        try { await copyFile(this.path, this.path + '.bak') } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      await rename(this.path + '.tmp', this.path)
      this.mainValid = true
    }).catch(error => this.onError(error))
    return this.queue
  }
}
