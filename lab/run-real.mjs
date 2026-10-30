import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseClass } from './jvm.js'
import { createVM2 } from './vm2.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const roots = [here, path.join(here, 'asm'), path.join(here, 'mixin'), path.join(here, 'jdk', 'classes')]
const classes = new Map()

function load(name) {
  if (classes.has(name)) return classes.get(name)
  for (const root of roots) {
    const file = path.join(root, name + '.class')
    if (fs.existsSync(file)) {
      const cls = parseClass(fs.readFileSync(file))
      classes.set(name, cls)
      return cls
    }
  }
  throw new Error('cannot load ' + name)
}

load('MixinRealTest')

let vm = null
for (let i = 0; i < 300; i++) {
  vm = createVM2([...classes.values()], {})
  try {
    const out = vm.runMain('MixinRealTest')
    console.log(out.join('\n'))
    break
  } catch (e) {
    if (e && e.missingClass) {
      console.log('load', e.missingClass)
      load(e.missingClass)
      continue
    }
    console.log('--- VM OUT ---')
    console.log(vm.out.join('\n'))
    console.log('--- ERROR ---')
    console.log(e && e.__jvm ? 'JVM exception ' + (e.value && e.value.__class) + ' at ' + e.where : e && e.stack ? e.stack : e)
    break
  }
}
