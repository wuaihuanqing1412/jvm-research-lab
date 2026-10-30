import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseClass } from './jvm.js'
import { createVM2 } from './vm2.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const roots = [here, path.join(here, 'asm'), path.join(here, 'mixin'), path.join(here, 'guava'), path.join(here, 'jdk', 'classes')]
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

load('MixinServiceTest')
for (const n of ['java/lang/Class','org/spongepowered/asm/service/MixinService','org/spongepowered/asm/mixin/MixinEnvironment','com/google/common/collect/ImmutableList','com/google/common/collect/ImmutableCollection','com/google/common/collect/ObjectArrays','java/lang/String']) { try { load(n) } catch (e) { console.log('preload skip', n) } }
let vm = null
for (let i = 0; i < 400; i++) {
  vm = createVM2([...classes.values()], {})
  try {
    console.log(vm.runMain('MixinServiceTest').join('\n'))
    break
  } catch (e) {
    if (e && e.missingClass) { load(e.missingClass); continue }
    console.log('--- VM OUT ---')
    console.log(vm.out.join('\n'))
    console.log('--- ERROR ---')
    if (e && e.__jvm) { const v=e.value; const m=v&&v.fields&&v.fields.detailMessage; let txt=''; if(m&&m.fields&&m.fields.value){ const b=m.fields.value; const c=m.fields.coder||0; txt=c===1?Buffer.from(b).toString('utf16le'):Buffer.from(b).toString('latin1') } console.log('JVM exception ' + (v&&v.__class) + ' at ' + e.where + ' :: ' + txt) } else { console.log(e && e.stack ? e.stack : e) }
    break
  }
}
