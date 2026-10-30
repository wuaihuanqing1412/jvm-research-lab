import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseClass } from './jvm.js'
import { createVM2 } from './vm2.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const roots = [here, path.join(here, 'asm'), path.join(here, 'mixin'), path.join(here, 'guava'), path.join(here, 'gson'), path.join(here, 'jdk', 'classes')]
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

load('RealMixinTest')
const dyn = new Uint8Array(fs.readFileSync(path.join(here, 'resources', 'dynamic.bin')))
for (const n of ['java/lang/Class','org/spongepowered/asm/service/MixinService','org/spongepowered/asm/mixin/MixinEnvironment','com/google/common/collect/ImmutableList','com/google/common/collect/ImmutableCollection','com/google/common/collect/ObjectArrays','java/lang/String']) { try { load(n) } catch (e) { console.log('preload skip', n) } }
let vm = null
const baseRes = {
  'dynamic.bin': dyn,
  'Dynamic.class': dyn,
  'testmix/RealMixin.class': new Uint8Array(fs.readFileSync(path.join(here, 'testmix', 'RealMixin.class')))
}
const resRoots = [path.join(here, 'jdk', 'classes'), path.join(here, 'guava'), path.join(here, 'gson'), path.join(here, 'asm'), path.join(here, 'mixin'), here]
const resMap = new Proxy(baseRes, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop]
    if (prop in target) return target[prop]
    for (const root of resRoots) {
      const file = path.join(root, prop)
      if (fs.existsSync(file)) { const bytes = new Uint8Array(fs.readFileSync(file)); target[prop] = bytes; return bytes }
    }
    return undefined
  }
})
for (let i = 0; i < 3000; i++) {
  vm = createVM2([...classes.values()], resMap, {})
  try {
    console.log(vm.runMain('RealMixinTest').join('\n'))
    break
  } catch (e) {
    if (e && e.missingClass) { console.log('RETRY(' + i + ') load ' + e.missingClass + ' known=' + classes.has(e.missingClass)); load(e.missingClass); continue }
    console.log('--- VM OUT ---')
    console.log(vm.out.join('\n'))
    console.log('--- ERROR ---')
    if (e && e.__jvm) { const v=e.value; const f=v&&v.fields||{}; const m=f.detailMessage; let txt=''; if(m&&m.fields&&m.fields.value){ const b=m.fields.value; const c=m.fields.coder||0; txt=c===1?Buffer.from(b).toString('utf16le'):Buffer.from(b).toString('latin1') } const c=f.cause; let ct=''; if(c&&c.fields&&c.fields.detailMessage){ const cm=c.fields.detailMessage; if(cm.fields&&cm.fields.value) ct=Buffer.from(cm.fields.value).toString(cm.fields.coder===1?'utf16le':'latin1') } console.log('JVM exception ' + (v&&v.__class) + ' at ' + e.where + ' :: ' + txt + ' cause=' + (c&&c.__class) + ':' + ct + ' keys=' + Object.keys(f).join(',')) } else { console.log(e && e.stack ? e.stack : e) }
    break
  }
}
