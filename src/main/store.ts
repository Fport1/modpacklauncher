import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'

class JsonStore<T extends object> {
  private data: T
  private filePath: string

  constructor(name: string, defaults: T) {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, `${name}.json`)
    this.data = this.load(defaults)
  }

  private load(defaults: T): T {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8')
      return { ...defaults, ...JSON.parse(content) }
    } catch {
      return { ...defaults }
    }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key]
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value
    fs.ensureDirSync(path.dirname(this.filePath))
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }

  getAll(): T {
    return { ...this.data }
  }

  setAll(data: Partial<T>): void {
    this.data = { ...this.data, ...data }
    fs.ensureDirSync(path.dirname(this.filePath))
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }
}

export default JsonStore
