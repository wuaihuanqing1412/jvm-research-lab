/* VM v2: objects, fields, arrays, StringBuilder, virtual/static dispatch.
   Still a toy: no exceptions, no GC, no JDK, no threads. */

import { parseClass, methodRef, fieldRef } from './jvm.js'

const PRINTER = { __printer: true }
const isRef = (v) => v && typeof v === 'object'

function argCount(desc) {
  const inside = desc.slice(1, desc.indexOf(')'))
  let n = 0
  for (let i = 0; i < inside.length; i++) {
    const c = inside[i]
    if (c === 'L') {
      n++
      i = inside.indexOf(';', i)
    } else if (c === '[') {
      n++
      while (inside[i + 1] === '[') i++
      if (inside[i + 1] === 'L') i = inside.indexOf(';', i)
      else i++
    } else {
      n++
    }
  }
  return n
}

function retKind(desc) {
  const r = desc.slice(desc.indexOf(')') + 1)
  if (r === 'V') return 'v'
  if (r[0] === 'L' || r[0] === '[') return 'a'
  return 'i'
}

export class MissingClassError extends Error {
  constructor(name) {
    super('missing class ' + name)
    this.missingClass = name
  }
}

export function createVM2(classList, resources = {}, hooks = {}, srg = null) {
  console.log('=== VM INSTANCE ===')
  const resourceMap = resources
  const glHooks = hooks.gl || null
  const srgMap = srg
  const recent = []
  const classObjectCache = new Map()
  const fieldOffsets = new Map()
  const hashIds = new WeakMap()
  let nextHash = 1
  const pseudoThread = { __class: 'java/lang/Thread' }
  const pseudoModule = { __class: 'java/lang/Module', __name: '', __layer: null }
  let nextFieldOffset = 100
  const classes = new Map()
  for (const c of classList) classes.set(c.thisName, c)
  const out = []
  let steps = 0

  const methodsOf = (cls) => {
    const m = new Map()
    for (const method of cls.methods) {
      method.__owner = cls
      m.set(method.name + method.desc, method)
    }
    return m
  }
  const methodCache = new Map()
  const getMethods = (cls) => {
    if (!methodCache.has(cls.thisName)) methodCache.set(cls.thisName, methodsOf(cls))
    return methodCache.get(cls.thisName)
  }

  function defaultValue(desc) {
    if (!desc) return null
    const c = desc[0]
    if (c === 'Z' || c === 'B' || c === 'C' || c === 'S' || c === 'I') return 0
    if (c === 'J' || c === 'F' || c === 'D') return 0
    return null
  }

  function makeJavaString(text) {
    const s = String(text)
    let wide = false
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) wide = true
    const bytes = []
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i)
      if (wide) {
        bytes.push(code & 0xff, code >> 8)
      } else {
        bytes.push(code & 0xff)
      }
    }
    return { __class: 'java/lang/String', fields: { value: bytes, coder: wide ? 1 : 0, hash: 0, hashIsZero: false } }
  }

  function stringValue(v) {
    if (typeof v === 'string') return v
    if (v && v.__class && /java\/lang\/(Integer|Long|Short|Byte|Float|Double|Boolean)/.test(v.__class) && v.fields && v.fields.value !== undefined) return String(v.fields.value)
    if (!v || v.__class !== 'java/lang/String') return String(v)
    if (!v.fields) return typeof v.__text === 'string' ? v.__text : ''
    const bytes = v.fields.value || []
    const coder = v.fields.coder || 0
    let out = ''
    if (coder === 1) {
      for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
    } else {
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] & 0xff)
    }
    return out
  }

  function listToArray(o) {
    if (o == null) return null
    if (Array.isArray(o)) return o
    if (o.__items) return o.__items
    if (o.__coll && o.items) return o.items
    if (!o.__class) return null
    try {
      const sm = resolveMethod({ cls: o.__class, name: 'size', desc: '()I' }, o)
      const gm = resolveMethod({ cls: o.__class, name: 'get', desc: '(I)Ljava/lang/Object;' }, o)
      if (!sm || !gm || !sm.method || !gm.method || !sm.method.code || !gm.method.code) return null
      const n = invoke(sm.method, o, []) | 0
      const arr = []
      for (let i = 0; i < n; i++) arr.push(invoke(gm.method, o, [i]))
      return arr
    } catch (e) {
      if (e && e.missingClass) throw e
      return null
    }
  }

  function newObject(className) {
    console.log('ALLOC ' + className)
    const fields = {}
    const seen = new Set()
    let name = className
    while (name && !seen.has(name)) {
      seen.add(name)
      const cls = classes.get(name)
      if (!cls) break
      for (const f of cls.fields || []) {
        if (!(f.name in fields)) fields[f.name] = defaultValue(f.desc)
      }
      name = cls.superName
    }
    if (className === 'org/spongepowered/asm/mixin/transformer/MixinConfig') { fields.name = makeJavaString('mixins.test.json'); fields.initialised = 0; fields.prepared = 0; fields.visited = 0 }
    return { __class: className, fields }
  }

  const initialized = new Set()
  const initializing = new Set()
  function isAssignable(actual, target) {
    if (!actual || !target) return false
    if (actual === target) return true
    const seen = new Set()
    const walk = (name) => {
      if (!name || seen.has(name)) return false
      seen.add(name)
      if (name === target) return true
      const cls = classes.get(name)
      if (!cls) return false
      if (walk(cls.superName)) return true
      for (const iface of cls.interfaceNames || []) {
        if (walk(iface)) return true
      }
      return false
    }
    return walk(actual)
  }

  function findHandler(method, pc, exClass) {
    const table = method.code.exceptions || []
    for (const e of table) {
      if (pc < e.startPc || pc >= e.endPc) continue
      if (!e.catchType || (exClass && isAssignable(exClass, e.catchType))) return e.handlerPc
    }
    return -1
  }

  function ensureInit(name) {
    if (initialized.has(name) || initializing.has(name)) return
    const cls = classes.get(name)
    if (!cls) return
    const clinit = getMethods(cls).get('<clinit>()V')
    if (!clinit) {
      initialized.add(name)
      return
    }
    initializing.add(name)
    try {
      invoke(clinit, null, [])
    } catch (e) {
      if (e && e.missingClass) throw e
      console.warn('clinit failed for ' + name + ': ' + e.message)
    } finally {
      initializing.delete(name)
      initialized.add(name)
    }
  }

  let currentMethod = ''
  const TRACE_RE = /org\/spongepowered\/asm\/mixin\/(injection|transformer\/(TargetClassContext|MixinApplicatorStandard|MixinTargetContext))/
  const argBrief = (v) => {
    if (v == null) return 'null'
    if (typeof v === 'number') return String(v)
    if (typeof v === 'string') return JSON.stringify(v)
    if (v.__class === 'java/lang/String') { try { return JSON.stringify(stringValue(v)) } catch (e) { return 'String?' } }
    if (v.__class) return v.__class.split('/').pop()
    if (Array.isArray(v)) return '[' + v.length + ']'
    return typeof v
  }
  const cid = (o) => (o && o.__cid ? o.__cid : (o ? (o.__cid = (globalThis.__cidSeq = (globalThis.__cidSeq || 0) + 1)) : '?'))
  const traceIn = (owner, name, desc, args) => {
    if (!TRACE_RE.test(String(owner))) return
    console.log('CALL ' + String(owner).split('/').pop() + '.' + name + desc + ' (' + args.map(argBrief).join(', ') + ')')
  }
  function invoke(method, recv, args) {
    if (!method.code) throw new Error('native method ' + method.name + ' in ' + (method.__owner && method.__owner.thisName) + ' recv=' + (recv && recv.__class) + ' at ' + currentMethod)
    recent.push((method.__owner && method.__owner.thisName) + '.' + method.name); if (recent.length > 24) recent.shift()
    const cls = method.__owner
    const prevMethod = currentMethod
    currentMethod = cls.thisName + '.' + method.name + method.desc
    traceIn(cls.thisName, method.name, method.desc, args)
    if (method.name !== '<clinit>') ensureInit(cls.thisName)
    const locals = new Array(Math.max(method.code.maxLocals, args.length + (recv ? 1 : 0)))
    let base = 0
    if (recv) locals[base++] = recv
    for (let i = 0; i < args.length; i++) locals[base + i] = args[i]

    const stack = []
    const code = method.code.bytes
    let pc = 0
    const push = (v) => stack.push(v)
    const pop = () => stack.pop()

    while (pc < code.length) {
      if (++steps > 30_000_000) throw new Error('step limit at ' + currentMethod + ' recent=' + recent.join(' <- '))
      const opPc = pc
      const op = code[pc++]
      try {
      switch (op) {
        case 0x02: push(-1); break
        case 0x03: push(0); break
        case 0x04: push(1); break
        case 0x05: push(2); break
        case 0x06: push(3); break
        case 0x07: push(4); break
        case 0x08: push(5); break
        case 0x09: push(0); break
        case 0x0a: push(1); break
        case 0x0e: push(0.0); break
        case 0x0f: push(1.0); break
        case 0x0b: push(0.0); break
        case 0x0c: push(1.0); break
        case 0x0d: push(2.0); break
        case 0x10: push((code[pc++] << 24) >> 24); break
        case 0x11: {
          const v = (code[pc] << 8) | code[pc + 1]
          pc += 2
          push((v << 16) >> 16)
          break
        }
        case 0x12: push(constant(cls, code[pc++])); break
        case 0x13: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          push(constant(cls, idx))
          break
        }
        case 0x14: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          push(constant(cls, idx))
          break
        }
        case 0x01: push(null); break

        case 0x15: push(locals[code[pc++]]); break
        case 0x1a: push(locals[0]); break
        case 0x1b: push(locals[1]); break
        case 0x1c: push(locals[2]); break
        case 0x1d: push(locals[3]); break
        case 0x19: push(locals[code[pc++]]); break
        case 0x17: push(locals[code[pc++]]); break
        case 0x22: push(locals[0]); break
        case 0x23: push(locals[1]); break
        case 0x24: push(locals[2]); break
        case 0x25: push(locals[3]); break
        case 0x18: push(locals[code[pc++]]); break
        case 0x16: push(locals[code[pc++]]); break
        case 0x1e: push(locals[0]); break
        case 0x1f: push(locals[1]); break
        case 0x20: push(locals[2]); break
        case 0x21: push(locals[3]); break
        case 0x26: push(locals[0]); break
        case 0x27: push(locals[1]); break
        case 0x28: push(locals[2]); break
        case 0x29: push(locals[3]); break
        case 0x38: locals[code[pc++]] = pop(); break
        case 0x39: locals[code[pc++]] = pop(); break
        case 0x37: locals[code[pc++]] = pop(); break
        case 0x3f: locals[0] = pop(); break
        case 0x40: locals[1] = pop(); break
        case 0x41: locals[2] = pop(); break
        case 0x42: locals[3] = pop(); break
        case 0x43: locals[0] = pop(); break
        case 0x44: locals[1] = pop(); break
        case 0x45: locals[2] = pop(); break
        case 0x46: locals[3] = pop(); break
        case 0x47: locals[0] = pop(); break
        case 0x48: locals[1] = pop(); break
        case 0x49: locals[2] = pop(); break
        case 0x4a: locals[3] = pop(); break
        case 0x2a: push(locals[0]); break
        case 0x2b: push(locals[1]); break
        case 0x2c: push(locals[2]); break
        case 0x2d: push(locals[3]); break
        case 0x36: locals[code[pc++]] = pop(); break
        case 0x3b: locals[0] = pop(); break
        case 0x3c: locals[1] = pop(); break
        case 0x3d: locals[2] = pop(); break
        case 0x3e: locals[3] = pop(); break
        case 0x3a: locals[code[pc++]] = pop(); break
        case 0x4b: locals[0] = pop(); break
        case 0x4c: locals[1] = pop(); break
        case 0x4d: locals[2] = pop(); break
        case 0x4e: locals[3] = pop(); break

        case 0x60: { const b = pop(); const a = pop(); push((a + b) | 0); break }
        case 0x61: { const b = pop(); const a = pop(); push(a + b); break }
        case 0x62: { const b = pop(); const a = pop(); push(Math.fround(a + b)); break }
        case 0x63: { const b = pop(); const a = pop(); push(a + b); break }
        case 0x65: { const b = pop(); const a = pop(); push(a - b); break }
        case 0x69: { const b = pop(); const a = pop(); push(a * b); break }
        case 0x67: { const b = pop(); const a = pop(); push(a - b); break }
        case 0x6b: { const b = pop(); const a = pop(); push(a * b); break }
        case 0x6f: { const b = pop(); const a = pop(); push(a / b); break }
        case 0x73: { const b = pop(); const a = pop(); push(a % b); break }
        case 0x77: push(-pop()); break
        case 0xaf: { const b = pop(); const a = pop(); push(a / b); break }
        case 0x6b: { const b = pop(); const a = pop(); push(a / b); break }
        case 0x6d: { const b = pop(); const a = pop(); push(a % b); break }
        case 0x71: { const b = pop(); const a = pop(); push(a % b); break }
        case 0x75: push(-pop()); break
        case 0x79: { const b = pop(); const a = pop(); push(a << (b & 63)); break }
        case 0x7b: { const b = pop(); const a = pop(); push(a >> (b & 63)); break }
        case 0x7d: { const b = pop(); const a = pop(); push(a >>> (b & 63)); break }
        case 0x7f: { const b = pop(); const a = pop(); push(a & b); break }
        case 0x81: { const b = pop(); const a = pop(); push(a | b); break }
        case 0x83: { const b = pop(); const a = pop(); push(a ^ b); break }
        case 0x64: { const b = pop(); const a = pop(); push((a - b) | 0); break }
        case 0x66: { const b = pop(); const a = pop(); push(Math.fround(a - b)); break }
        case 0x68: { const b = pop(); const a = pop(); push((a * b) | 0); break }
        case 0x6a: { const b = pop(); const a = pop(); push(Math.fround(a * b)); break }
        case 0x6c: { const b = pop(); const a = pop(); push((a / b) | 0); break }
        case 0x6e: { const b = pop(); const a = pop(); push(Math.fround(a / b)); break }
        case 0x70: { const b = pop(); const a = pop(); push(a % b); break }
        case 0x74: push(-pop()); break
        case 0x76: push(-pop()); break
        case 0x86: push(Math.fround(pop() | 0)); break
        case 0x85: push(pop() | 0); break
        case 0x87: push(pop() | 0); break
        case 0x88: push(pop() | 0); break
        case 0x89: push(pop() | 0); break
        case 0x8a: push(pop() | 0); break
        case 0x8e: push(pop() | 0); break
        case 0x8f: push(pop() | 0); break
        case 0x91: push((pop() << 24) >> 24); break
        case 0x92: push(pop() & 0xffff); break
        case 0x93: push((pop() << 16) >> 16); break
        case 0x8b: push(pop() | 0); break
        case 0x8d: push(pop()); break
        case 0x90: push(Math.fround(pop())); break
        case 0x78: { const b = pop(); const a = pop(); push(a << (b & 31)); break }
        case 0x7a: { const b = pop(); const a = pop(); push(a >> (b & 31)); break }
        case 0x7c: { const b = pop(); const a = pop(); push(a >>> (b & 31)); break }
        case 0x7e: { const b = pop(); const a = pop(); push(a & b); break }
        case 0x80: { const b = pop(); const a = pop(); push(a | b); break }
        case 0x82: { const b = pop(); const a = pop(); push(a ^ b); break }
        case 0x84: {
          const idx = code[pc++]
          const inc = (code[pc++] << 24) >> 24
          locals[idx] = (locals[idx] + inc) | 0
          break
        }

        case 0x99: case 0x9a: case 0x9b: case 0x9c: case 0x9d: case 0x9e: {
          const v = pop()
          const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16
          pc += 2
          const ok =
            (op === 0x99 && v === 0) ||
            (op === 0x9a && v !== 0) ||
            (op === 0x9b && v < 0) ||
            (op === 0x9c && v >= 0) ||
            (op === 0x9d && v > 0) ||
            (op === 0x9e && v <= 0)
          if (ok) pc += off - 3
          break
        }
        case 0x9f: case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: {
          const b = pop()
          const a = pop()
          const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16
          pc += 2
          const ok =
            (op === 0x9f && a === b) ||
            (op === 0xa0 && a !== b) ||
            (op === 0xa1 && a < b) ||
            (op === 0xa2 && a >= b) ||
            (op === 0xa3 && a > b) ||
            (op === 0xa4 && a <= b)
          if (ok) pc += off - 3
          break
        }
        case 0xa7: {
          const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16
          pc += 2
          pc += off - 3
          break
        }
        case 0xa5:
        case 0xa6: {
          const b = pop()
          const a = pop()
          const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16
          pc += 2
          const ok = op === 0xa5 ? a === b : a !== b
          if (ok) pc += off - 3
          break
        }
        case 0xc6: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v == null) pc += off - 3; break }
        case 0xc7: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v != null) pc += off - 3; break }

        case 0xbb: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const name = classNameAt(cls, idx)
          if (String(name).indexOf('MixinConfig') >= 0) console.log('NEW ' + name)
          ensureInit(name)
          push(newObject(name))
          break
        }
        case 0xbc: {
          const atype = code[pc++]
          const n = pop()
          const primitive = atype >= 4 && atype <= 11
          const arr = new Array(n).fill(primitive ? 0 : null)
          arr.__array = true
          push(arr)
          break
        }
        case 0xbd: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const n = pop()
          const arr = new Array(n).fill(null)
          arr.__array = true
          arr.__class = classNameAt(cls, idx)
          push(arr)
          break
        }
        case 0xbe: { const a = pop(); push(a ? a.length : 0); break }
        case 0x30: { const i = pop(); const a = pop(); push(a ? a[i] : 0); break }
        case 0x51: { const v = pop(); const i = pop(); const a = pop(); if (a) a[i] = v; break }
        case 0x2e:
        case 0x2f:
        case 0x31:
        case 0x33:
        case 0x34:
        case 0x35: { const i = pop(); const a = pop(); push(a ? a[i] : 0); break }
        case 0x4f:
        case 0x50:
        case 0x52:
        case 0x54:
        case 0x55:
        case 0x56: { const v = pop(); const i = pop(); const a = pop(); if (a) { if (a.__swmap) console.log('SWSTORE i=' + i + ' v=' + v + ' len=' + a.length); a[i] = v } break }
        case 0x32: { const i = pop(); const a = pop(); push(a ? a[i] : 0); break }
        case 0x53: { const v = pop(); const i = pop(); const a = pop(); if (a) a[i] = v; break }

        case 0xb2: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const f = fieldRef(cls, cls.cp, idx)
          if (!classes.has(f.cls) && strictMissing(f.cls)) throw new MissingClassError(f.cls)
          ensureInit(f.cls)
          if (f.cls === 'java/lang/System' && f.name === 'out') push(PRINTER)
          else if (f.name === 'TYPE') {
            const prim = { 'java/lang/Integer': 'int', 'java/lang/Long': 'long', 'java/lang/Boolean': 'boolean', 'java/lang/Byte': 'byte', 'java/lang/Character': 'char', 'java/lang/Short': 'short', 'java/lang/Float': 'float', 'java/lang/Double': 'double', 'java/lang/Void': 'void' }
            push(classObject(prim[f.cls] || 'void'))
          } else if (f.cls === 'org/objectweb/asm/Opcodes' && /^ASM\\d+$/.test(f.name)) push(parseInt(f.name.slice(3), 10) << 16)
          else {
            const sv = staticField(f.cls, f.name)
            if (String(f.name).indexOf('$SwitchMap') === 0) { if (sv) sv.__swmap = true; console.log('SWITCHMAP ' + f.cls.split('/').pop() + '.' + f.name + ' = ' + (sv ? JSON.stringify(sv) : String(sv))) }
            push(sv)
          }
          break
        }
        case 0xb3: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const f = fieldRef(cls, cls.cp, idx)
          if (!classes.has(f.cls) && strictMissing(f.cls)) throw new MissingClassError(f.cls)
          ensureInit(f.cls)
          setStaticField(f.cls, f.name, pop())
          break
        }
        case 0xb4: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const f = fieldRef(cls, cls.cp, idx)
          const obj = pop()
          if (!obj || !obj.fields) throw new Error('bad getfield ' + f.name + ' obj=' + String(obj) + ' in ' + cls.thisName + '.' + method.name)
          push(obj.fields[f.name])
          break
        }
        case 0xb5: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const f = fieldRef(cls, cls.cp, idx)
          const v = pop()
          const obj = pop()
          if (!obj || !obj.fields) throw new Error('bad putfield ' + f.cls + '.' + f.name + ' obj=' + String(obj && obj.__class ? obj.__class : obj) + ' in ' + cls.thisName + '.' + method.name + ' recent=' + recent.slice(-10).join(' <- '))
          obj.fields[f.name] = v
          break
        }

        case 0xba: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 4
          const indy = cls.cp[idx]
          const nt = cls.cp[indy.b]
          const desc = cls.cp[nt.b].value
          const bs = (cls.bootstrapMethods || [])[indy.a]
          const mh = cls.cp[bs.ref]
          const target = methodRef(cls, cls.cp, mh.b)
          const n = argCount(desc)
          const args = new Array(n)
          for (let i = n - 1; i >= 0; i--) args[i] = pop()
          if (target.cls === 'java/lang/invoke/StringConcatFactory') {
            let recipe = null
            let constants = []
            if (bs.args.length) {
              const first = cls.cp[bs.args[0]]
              if (first.tag === 8) recipe = cls.cp[first.index].value
              constants = bs.args.slice(recipe !== null ? 1 : 0).map((i) => constValue(cls, i))
            }
            let text = ''
            if (recipe === null) {
              text = args.map((a) => stringValue(a)).join('')
            } else {
              let ai = 0
              let ci = 0
              for (const ch of recipe) {
                if (ch === '\u0001') text += stringValue(args[ai++])
                else if (ch === '\u0002') text += stringValue(constants[ci++])
                else text += ch
              }
            }
            push(makeJavaString(text))
            break
          }
          throw new Error('unsupported invokedynamic ' + target.cls + '.' + target.name)
        }

        case 0xb8: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const ref = methodRef(cls, cls.cp, idx)
          const n = argCount(ref.desc)
          const args = new Array(n)
          for (let i = n - 1; i >= 0; i--) args[i] = pop()
          if (ref.cls === 'java/lang/Integer' && ref.name === 'valueOf') {
            push({ __class: 'java/lang/Integer', __int: args[0] | 0, fields: { value: args[0] | 0 } })
            break
          }
          if (ref.cls === 'java/lang/Boolean' && ref.name === 'valueOf') {
            push({ __class: 'java/lang/Boolean', __int: args[0] ? 1 : 0, fields: { value: args[0] ? 1 : 0 } })
            break
          }
          if (ref.cls === 'java/lang/Long' && ref.name === 'valueOf') {
            push({ __class: 'java/lang/Long', __long: args[0], fields: { value: args[0] } })
            break
          }
          if ((ref.cls === 'java/lang/Character' || ref.cls === 'java/lang/Short' || ref.cls === 'java/lang/Byte') && ref.name === 'valueOf') {
            push({ __class: ref.cls, __int: args[0] | 0, fields: { value: args[0] | 0 } })
            break
          }
          if (ref.cls === 'java/util/Objects' && ref.name === 'checkIndex') {
            if (args[0] < 0 || args[0] >= args[1]) throw new Error('IndexOutOfBounds ' + args[0] + ' at ' + currentMethod + ' recent=' + recent.slice(-10).join(' <- '))
            push(args[0])
            break
          }
          const native = nativeCall(ref, null, args)
          if (native.handled) {
            if (retKind(ref.desc) !== 'v') push(native.value)
            break
          }
          const target = resolveMethod(ref, null)
          const result = invoke(target.method, null, args)
          if (retKind(ref.desc) !== 'v') push(result)
          break
        }
        case 0xb6:
        case 0xb9: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          if (op === 0xb9) pc += 2
          const ref = methodRef(cls, cls.cp, idx)
          const n = argCount(ref.desc)
          const args = new Array(n)
          for (let i = n - 1; i >= 0; i--) args[i] = pop()
          const recv = pop()
          if (ref.cls === 'org/objectweb/asm/ClassReader' && ref.name === 'accept') out.push('ACCEPT flags=' + args[1] + ' typeof=' + typeof args[1])
          if (recv && recv.__annotation) {
            const value = recv.__values[ref.name]
            push(typeof value === 'string' ? makeJavaString(value) : value)
            break
          }
          if (ref.cls === 'java/io/PrintStream' && recv === PRINTER) {
            out.push(stringValue(args[0]))
            break
          }
          if (recv && recv.__int !== undefined && ref.name === 'intValue') {
            push(recv.__int)
            break
          }
          const native = nativeCall(ref, recv, args)
          if (native.handled) {
            if (retKind(ref.desc) !== 'v') push(native.value)
            break
          }
          const target = resolveMethod(ref, recv)
          const result = invoke(target.method, recv, args)
          if (retKind(ref.desc) !== 'v') push(result)
          break
        }
        case 0xb7: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const ref = methodRef(cls, cls.cp, idx)
          const n = argCount(ref.desc)
          const args = new Array(n)
          for (let i = n - 1; i >= 0; i--) args[i] = pop()
          const recv = pop()
          if (ref.cls === 'java/lang/Object' && ref.name === '<init>') break
          const native = nativeCall(ref, recv, args)
          if (native.handled) break
          const target = resolveMethod(ref, recv, true)
          const result = invoke(target.method, recv, args)
          if (retKind(ref.desc) !== 'v') push(result)
          break
        }

        case 0x57: pop(); break
        case 0x59: { const v = pop(); push(v); push(v); break }
        case 0x5a: {
          const v1 = pop()
          const v2 = pop()
          push(v1)
          push(v2)
          push(v1)
          break
        }
        case 0x5b: {
          const v1 = pop()
          const v2 = pop()
          const v3 = pop()
          push(v1)
          push(v3)
          push(v2)
          push(v1)
          break
        }
        case 0x5c: {
          const b = pop()
          const a = pop()
          push(a)
          push(b)
          push(a)
          push(b)
          break
        }
        case 0x5d: {
          const c = pop()
          const b = pop()
          const a = pop()
          push(b)
          push(c)
          push(a)
          push(b)
          push(c)
          break
        }
        case 0x5e: {
          const b = pop()
          const a = pop()
          push(a)
          push(b)
          push(a)
          push(b)
          break
        }
        case 0xc0: {
          pc += 2
          break
        }
        case 0xc1: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const target = classNameAt(cls, idx)
          const v = pop()
          let ok = 0
          if (v && v.__class) {
            try {
              ok = isAssignable(v.__class, target) ? 1 : 0
            } catch (e) {
              ok = 0
            }
          }
          if (target === 'java/util/List' && v && v.__class === 'java/util/ArrayList') {
            const ac = classes.get('java/util/ArrayList')
            console.log('INSTANCEOF List vClass=' + v.__class + ' ok=' + ok + ' ifaces=' + (ac ? JSON.stringify(ac.interfaceNames) : 'nocls'))
          }
          push(ok)
          break
        }
        case 0xaa: {
          let p = pc
          p += (4 - (p % 4)) % 4
          const read4 = (q) => (code[q] << 24) | (code[q + 1] << 16) | (code[q + 2] << 8) | code[q + 3]
          const def = read4(p)
          p += 4
          const low = read4(p)
          const high = read4(p + 4)
          p += 8
          const key = pop()
          let rel = def
          if (key >= low && key <= high) rel = read4(p + (key - low) * 4)
          pc = opPc + rel
          break
        }
        case 0xab: {
          let p = pc
          p += (4 - (p % 4)) % 4
          const read4 = (q) => (code[q] << 24) | (code[q + 1] << 16) | (code[q + 2] << 8) | code[q + 3]
          const def = read4(p)
          p += 4
          const n = read4(p)
          p += 4
          const key = pop()
          let rel = def
          for (let i = 0; i < n; i++) {
            const match = read4(p + i * 8)
            if (match === key) {
              rel = read4(p + i * 8 + 4)
              break
            }
          }
          pc = opPc + rel
          break
        }
        case 0x94: {
          const b = pop()
          const a = pop()
          push(a > b ? 1 : a < b ? -1 : 0)
          break
        }
        case 0x95:
        case 0x96: {
          const b = pop()
          const a = pop()
          let r
          if (Number.isNaN(a) || Number.isNaN(b)) r = op === 0x95 ? -1 : 1
          else r = a > b ? 1 : a < b ? -1 : 0
          push(r)
          break
        }
        case 0x97:
        case 0x98: {
          const b = pop()
          const a = pop()
          let r
          if (Number.isNaN(a) || Number.isNaN(b)) r = op === 0x97 ? -1 : 1
          else r = a > b ? 1 : a < b ? -1 : 0
          push(r)
          break
        }
        case 0xc2:
        case 0xc3: {
          pop()
          break
        }
        case 0xbf: {
          const exv = pop()
          if (exv && exv.__class === 'java/lang/ArrayIndexOutOfBoundsException' && !globalThis.__aioobeLogged) {
            globalThis.__aioobeLogged = true
            console.log('AIOOBE THROW at ' + currentMethod + ' recent=' + recent.slice(-18).join(' <- '))
          }
          throw { __jvm: true, value: exv, where: currentMethod }
        }
        case 0xac: {
          const ret = pop()
          if (typeof ret !== 'number') throw new Error('IRETURN type mismatch: got ' + (ret && ret.__class ? ret.__class : typeof ret) + ' at ' + currentMethod + ' recent=' + recent.slice(-10).join(' <- '))
          currentMethod = prevMethod
          return ret
        }
        case 0xad: { const r = pop(); currentMethod = prevMethod; return r }
        case 0xae: { const r = pop(); currentMethod = prevMethod; return r }
        case 0xb0: { const r = pop(); currentMethod = prevMethod; return r }
        case 0xb1: currentMethod = prevMethod; return undefined
        default:
          throw new Error('unsupported opcode 0x' + op.toString(16) + ' in ' + cls.thisName + '.' + method.name)
      }
      } catch (err) {
        if (err && err.__jvm) {
          const handler = findHandler(method, opPc, err.value && err.value.__class)
          if (handler >= 0) {
            stack.length = 0
            push(err.value)
            pc = handler
            continue
          }
        }
        throw err
      }
    }
    return undefined
  }

  const staticFields = new Map()
  for (const cls of classList) {
    for (const f of cls.fields || []) {
      if (f.access & 0x0008) staticFields.set(cls.thisName + '.' + f.name, defaultValue(f.desc))
    }
  }
  const strictMissing = (name) => /^(org\/spongepowered|org\/objectweb|com\/google)\//.test(String(name))
  function staticField(clsName, name) {
    return staticFields.get(clsName + '.' + name)
  }
  function setStaticField(clsName, name, value) {
    staticFields.set(clsName + '.' + name, value)
  }

  function classNameAt(cls, idx) {
    const c = cls.cp[idx]
    return cls.cp[c.index].value
  }

  function lookupMethod(name, key, seen) {
    if (!name || seen.has(name)) return null
    seen.add(name)
    const cls = classes.get(name)
    if (!cls) throw new MissingClassError(name)
    const method = getMethods(cls).get(key)
    if (method) return { cls, method }
    const viaSuper = lookupMethod(cls.superName, key, seen)
    if (viaSuper) return viaSuper
    for (const iface of cls.interfaceNames || []) {
      const found = lookupMethod(iface, key, seen)
      if (found) return found
    }
    return null
  }

  function alternateMember(owner, name, desc, isField) {
    if (!srgMap || !owner) return null
    const cls = srgMap[owner]
    if (!cls) return null
    if (!isField) {
      const key = name + ' ' + desc
      if (cls.m && cls.m[key]) return cls.m[key]
      if (cls.m) {
        for (const k of Object.keys(cls.m)) {
          if (cls.m[k] === name && k.endsWith(' ' + desc)) return k.slice(0, k.length - desc.length - 1)
        }
      }
    } else {
      if (cls.f && cls.f[name]) return cls.f[name]
      if (cls.f) {
        for (const k of Object.keys(cls.f)) {
          if (cls.f[k] === name) return k
        }
      }
    }
    return null
  }

  function resolveMethod(ref, recv, exact = false) {
    const key = ref.name + ref.desc
    if (exact) {
      const cls = classes.get(ref.cls)
      if (!cls) throw new MissingClassError(ref.cls)
      const method = getMethods(cls).get(key)
      if (method) return { cls, method }
      throw new Error('no method ' + ref.cls + '.' + key)
    }
    const start = recv && recv.__class ? recv.__class : ref.cls
    const found = lookupMethod(start, key, new Set())
    if (found) return found
    const refCls = classes.get(ref.cls)
    if (!refCls) throw new MissingClassError(ref.cls)
    const viaRef = lookupMethod(ref.cls, key, new Set())
    if (viaRef) return viaRef
    const alt = alternateMember(start, ref.name, ref.desc, false) || alternateMember(ref.cls, ref.name, ref.desc, false)
    if (alt) {
      const viaAlt = lookupMethod(start, alt + ref.desc, new Set()) || lookupMethod(ref.cls, alt + ref.desc, new Set())
      if (viaAlt) return viaAlt
    }
    throw new Error('no method ' + start + '.' + key)
  }

  function classObject(name) {
    if (!classObjectCache.has(name)) {
      classObjectCache.set(name, { __class: 'java/lang/Class', __className: name })
    }
    return classObjectCache.get(name)
  }

  function classFromDesc(desc) {
    if (!desc) return null
    if (desc[0] === 'L') return classObject(desc.slice(1, -1))
    const prim = { I: 'int', J: 'long', Z: 'boolean', B: 'byte', C: 'char', S: 'short', F: 'float', D: 'double', V: 'void' }
    return classObject(prim[desc[0]] || desc)
  }

  function paramsFromDesc(desc) {
    const inside = desc.slice(1, desc.indexOf(')'))
    const out = []
    for (let i = 0; i < inside.length; i++) {
      const c = inside[i]
      if (c === 'L') {
        const end = inside.indexOf(';', i)
        out.push(classObject(inside.slice(i + 1, end)))
        i = end
      } else if (c === '[') {
        let j = i
        while (inside[j] === '[') j++
        if (inside[j] === 'L') {
          const end = inside.indexOf(';', j)
          out.push(classObject(inside.slice(i, end + 1)))
          i = end
        } else {
          out.push(classObject(inside.slice(i, j + 1)))
          i = j
        }
      } else {
        out.push(classFromDesc(c))
      }
    }
    return out
  }

  function genericTypeName(sig) {
    if (!sig) return null
    let s = sig
    if (s[0] === '<') {
      let depth = 0
      let i = 0
      for (; i < s.length; i++) {
        if (s[i] === '<') depth++
        else if (s[i] === '>') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
      }
      s = s.slice(i)
    }
    if (s[0] !== 'L') return s
    let depth = 0
    let end = 1
    for (; end < s.length; end++) {
      if (s[end] === '<') depth++
      else if (s[end] === '>') depth--
      else if (s[end] === ';' && depth === 0) break
    }
    const body = s.slice(1, end)
    return body
      .replace(/L([^<>;]+);/g, (_, n) => n.replace(/\//g, '.'))
      .replace(/\//g, '.')
  }

  function annotationClass(type) {
    return type && type.startsWith('L') ? type.slice(1, -1) : type
  }

  function annotationObject(annot) {
    return {
      __class: annotationClass(annot.type),
      __annotation: true,
      __type: annot.type,
      __values: annot.values || {},
    }
  }

  function findAnnotation(list, target) {
    return (list || []).find((a) => annotationClass(a.type) === target) || null
  }

  function findField(clsName, fieldName, walkSuper) {
    let cls = classes.get(clsName)
    if (!cls) throw new MissingClassError(clsName)
    while (cls) {
      const field = (cls.fields || []).find((f) => f.name === fieldName)
      if (field) return { cls, field }
      if (!walkSuper || !cls.superName) break
      const next = classes.get(cls.superName)
      if (!next) throw new MissingClassError(cls.superName)
      cls = next
    }
    return null
  }

  function findMethodByName(name, methodName, paramDesc) {
    const seen = new Set()
    function walk(clsName) {
      if (!clsName || seen.has(clsName)) return null
      seen.add(clsName)
      const cls = classes.get(clsName)
      if (!cls) throw new MissingClassError(clsName)
      for (const method of cls.methods) {
        if (method.name !== methodName) continue
        if (!method.desc.startsWith('(' + paramDesc + ')')) continue
        return { owner: cls, method }
      }
      const viaSuper = walk(cls.superName)
      if (viaSuper) return viaSuper
      for (const iface of cls.interfaceNames || []) {
        const found = walk(iface)
        if (found) return found
      }
      return null
    }
    return walk(name)
  }

  function descriptorOf(classObj) {
    const name = classObj && classObj.__className
    if (name && name.startsWith('[')) return name
    if (name === 'int') return 'I'
    if (name === 'long') return 'J'
    if (name === 'boolean') return 'Z'
    if (name === 'byte') return 'B'
    if (name === 'char') return 'C'
    if (name === 'short') return 'S'
    if (name === 'float') return 'F'
    if (name === 'double') return 'D'
    if (name === 'void') return 'V'
    return 'L' + name + ';'
  }

  function nativeCall(ref, recv, args) {
    const rc = recv && recv.__class
    if (rc === 'java/lang/String' && (ref.name === 'hashCode' || ref.name === 'equals' || ref.name === 'toString' || ref.name === 'length' || ref.name === 'isEmpty')) {
      const txt = stringValue(recv)
      if (ref.name === 'hashCode') { let h = 0; for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0; return { handled: true, value: h } }
      if (ref.name === 'equals') { const o = args[0]; return { handled: true, value: o && o.__class === 'java/lang/String' && stringValue(o) === txt ? 1 : 0 } }
      if (ref.name === 'toString') return { handled: true, value: makeJavaString(txt) }
      if (ref.name === 'length') return { handled: true, value: txt.length }
      if (ref.name === 'isEmpty') return { handled: true, value: txt.length === 0 ? 1 : 0 }
    }
    if (ref.cls === 'java/lang/Class' && (ref.name === 'getPrimitiveClass' || ref.name === 'primitiveClass')) return { handled: true, value: classObject(args[0] && args[0].__class === 'java/lang/String' ? stringValue(args[0]) : String(args[0])) }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinPreProcessorStandard$SpecialMethod' && ref.name === 'of') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: 'of', desc: ref.desc }, null)
        const rr = invoke(mm.method, null, args)
        console.log('SPECIALMETHOD.OF -> ' + (rr == null ? 'null' : (rr.__name || rr.__class || typeof rr)))
        return { handled: true, value: rr }
      } catch (e) { console.log('SPECIALMETHOD.OF ERR ' + e.message) }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/ClassInfo' && ref.name === '<init>' && ref.desc === '(Lorg/objectweb/asm/tree/ClassNode;)V') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: '<init>', desc: ref.desc }, recv)
        invoke(mm.method, recv, args)
        return { handled: true }
      } catch (e) {
        const msg = e && e.__jvm ? (e.value && e.value.__class) + ':' + stringValue(e.value && e.value.fields && e.value.fields.detailMessage) : (e && e.message)
        console.log('CLASSINFO INIT ERR ' + msg + ' at ' + (e && e.where) + ' node=' + (args[0] && args[0].fields && args[0].fields.name ? stringValue(args[0].fields.name) : '?'))
        throw e
      }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/ClassInfo' && ref.name === 'forName' && stringValue(args[0]) === 'java/lang/System') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: 'forName', desc: ref.desc }, null)
        const rr = invoke(mm.method, null, args)
        console.log('CIFORNAME ok ' + (rr ? 'obj' : 'null'))
        return { handled: true, value: rr }
      } catch (e) {
        const msg = e && e.__jvm ? (e.value && e.value.__class) + ':' + stringValue(e.value && e.value.fields && e.value.fields.detailMessage) : (e && e.message)
        console.log('CIFORNAME ERR ' + msg + ' at ' + (e && e.where))
        throw e
      }
    }
    if (ref.cls === 'org/objectweb/asm/Type' && (ref.name === 'getType' || ref.name === 'getMethodType' || ref.name === 'getObjectType' || ref.name === 'getArgumentTypes')) {
      let d = ''
      try { d = args[0] && args[0].__class === 'java/lang/String' ? stringValue(args[0]) : String(args[0]) } catch (e) {}
      if (d.indexOf('java/net/URL') >= 0) console.log('TYPE.' + ref.name + ' desc=' + d + ' from=' + currentMethod + ' recent=' + recent.slice(-12).join(' <- '))
    }
    if (ref.cls === 'org/spongepowered/asm/util/Bytecode' && ref.name === 'getFirstNonArgLocalIndex') {
      const mn = args[0]
      const nm = mn && mn.fields && mn.fields.name ? stringValue(mn.fields.name) : '?'
      const ds = mn && mn.fields && mn.fields.desc ? stringValue(mn.fields.desc) : '?'
      console.log('FIRSTNONARG ' + nm + ds + ' from=' + currentMethod)
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/PluginHandle') {
      if (ref.name === 'isAvailable') return { handled: true, value: 0 }
      if (ref.name === 'shouldApplyMixin') return { handled: true, value: 1 }
      if (ref.name === 'getMixins') return { handled: true, value: { __class: 'java/util/ArrayList', __items: [], fields: { elementData: [], size: 0 } } }
      if (ref.name === 'getRefMapperConfig' || ref.name === 'get') return { handled: true, value: null }
      if (ref.name === 'onLoad') return { handled: true }
    }
    if (ref.name === 'parseTargets' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo' && !recv) console.log('PARSETARGETS UNDEF at ' + currentMethod + ' recent=' + recent.slice(-12).join(' <- '))
    if (ref.name === 'applyMixin' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinApplicatorStandard') console.log('APPLYMIXIN pass=' + (args[1] && args[1].fields ? (stringValue(args[1].fields.name) + '/' + args[1].fields.ordinal) : String(args[1])))
    if (ref.cls === 'java/lang/Enum' && ref.name === '<init>') console.log('ENUMINIT name=' + stringValue(args[0]) + ' ord=' + args[1] + ' cls=' + (recv && recv.__class))
    if (ref.name === 'ordinal' && recv && recv.fields && recv.fields.name && recv.fields.name.__class === 'java/lang/String') {
      const nm = stringValue(recv.fields.name)
      if (nm === 'MAIN' || nm === 'PREINJECT' || nm === 'INJECT') console.log('ORD ' + nm + '=' + recv.fields.ordinal + ' at ' + currentMethod)
    }
    if (ref.name === 'ordinal' && ref.desc === '()I' && recv && recv.fields && typeof recv.fields.ordinal === 'number') return { handled: true, value: recv.fields.ordinal }
    if (ref.cls === 'org/objectweb/asm/SymbolTable' && ref.name === 'addConstant') {
      const v = args[0]
      if (v && v.__class && (v.__class === 'java/util/ArrayList' || v.__class === 'java/util/List')) console.log('ADDCONST ' + v.__class + ' at ' + currentMethod + ' recent=' + recent.slice(-12).join(' <- '))
    }
    if ((ref.cls === 'org/objectweb/asm/AnnotationWriter' || ref.cls === 'org/objectweb/asm/AnnotationVisitor') && ref.name === 'visit') {
      const v = args[1]
      const vt = v == null ? 'null' : (v.__class ? v.__class : typeof v)
      const supported = v == null || ['java/lang/String', 'java/lang/Byte', 'java/lang/Boolean', 'java/lang/Character', 'java/lang/Short', 'java/lang/Integer', 'java/lang/Long', 'java/lang/Float', 'java/lang/Double'].includes(v.__class) || (v.__class && v.__class.indexOf('org/objectweb/asm/Type') === 0)
      if (!supported) console.log('AW.VISIT name=' + stringValue(args[0]) + ' value=' + vt + ' at ' + currentMethod + ' recent=' + recent.slice(-8).join(' <- '))
    }
    if (ref.cls === 'org/objectweb/asm/SymbolTable' && ref.name === 'addConstant') {
      const v0 = args[0]
      console.log('ADDCONST val=' + (v0 == null ? 'null' : (v0.__class || typeof v0)) + ' caller=' + currentMethod)
    }
    if (ref.name === 'applyInjections' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinTargetContext') {
      const szl = (l) => (l && l.__items ? l.__items.length : (l && l.fields && typeof l.fields.size === 'number' ? l.fields.size : '?'))
      console.log('APPLYINJ injectors=' + szl(recv.fields.injectors) + ' merged=' + szl(recv.fields.mergedMethods))
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/struct/InjectionInfo' && (ref.name === 'parse' || ref.name === 'isValid')) {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: ref.name, desc: ref.desc }, null)
        const rr = invoke(mm.method, ref.name === 'parse' ? null : recv, args)
        const sz = (l) => (l == null ? 'null' : (l.__items ? l.__items.length : (l.fields && typeof l.fields.size === 'number' ? l.fields.size : (Array.isArray(l) ? l.length : 'obj'))))
        const mnode = recv && recv.fields ? recv.fields.method : null
        const mname = mnode && mnode.fields ? stringValue(mnode.fields.name) + mnode.fields.desc : '?'
        const detail = ref.name === 'isValid' ? ' targets=' + sz(recv.fields.targets) + ' points=' + sz(recv.fields.injectionPoints) + ' selectors=' + sz(recv.fields.selectors) + ' method=' + mname + ' atKey=' + (recv.fields.atKey ? stringValue(recv.fields.atKey) : '?') : ''
        console.log('INJ.' + ref.name + ' -> ' + (rr == null ? 'null' : (rr.__class ? rr.__class.split('/').pop() : String(rr))) + detail)
        if (ref.name === 'parse' && rr == null) {
          const reg = staticField('org/spongepowered/asm/mixin/injection/struct/InjectionInfo', 'registry')
          const anns = staticField('org/spongepowered/asm/mixin/injection/struct/InjectionInfo', 'registeredAnnotations')
          console.log('INJ.parse-detail registry=' + (reg ? (reg.__map ? 'chm:' + reg.__map.size : (reg.__items ? 'items:' + reg.__items.length : 'obj')) : String(reg)) + ' anns=' + (anns ? (anns.length !== undefined ? anns.length : 'obj') : String(anns)))
        }
        return { handled: true, value: rr }
      } catch (e) { console.log('INJ.' + ref.name + ' ERR ' + (e && e.message)); throw e }
    }
    if (ref.cls === 'java/lang/Class' && (ref.name === 'getAnnotation' || ref.name === 'getDeclaredAnnotation')) {
      console.log('GETANN-ENTER recv=' + (recv && recv.__className) + ' want=' + (args[0] && args[0].__className) + ' found=' + !!(recv && recv.__className && classes.get(recv.__className)))
      const clsName = recv && recv.__className
      const targetDesc = args[0] && args[0].__className ? 'L' + args[0].__className + ';' : null
      const cls = clsName ? classes.get(clsName) : null
      if (!cls && clsName && strictMissing(clsName)) throw new MissingClassError(clsName)
      const ann = cls && cls.annotations && targetDesc ? cls.annotations.find((a) => a.type === targetDesc) : null
      if (targetDesc && targetDesc.indexOf('InjectionInfo$AnnotationType') >= 0) console.log('GETANN ' + clsName + ' -> ' + (ann ? 'yes' : 'no') + ' anns=' + (cls && cls.annotations ? cls.annotations.length : 'nocls'))
      if (!ann) return { handled: true, value: null }
      const vals = {}
      for (const k of Object.keys(ann.values || {})) {
        const v = ann.values[k]
        if (v && v.classDesc) vals[k] = classFromDesc(v.classDesc)
        else if (typeof v === 'string') vals[k] = makeJavaString(v)
        else if (Array.isArray(v)) vals[k] = v.map((x) => (x && x.classDesc ? classFromDesc(x.classDesc) : typeof x === 'string' ? makeJavaString(x) : x))
        else vals[k] = v
      }
      return { handled: true, value: { __annotation: true, __class: targetDesc ? targetDesc.slice(1, -1) : 'java/lang/annotation/Annotation', __values: vals } }
    }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && (ref.name === 'getSingleVisible' || ref.name === 'getSingleInvisible')) {
      const node = args[0]
      const classesArg = args[1]
      const listField = ref.name === 'getSingleVisible' ? 'visibleAnnotations' : 'invisibleAnnotations'
      const list = node && node.fields ? node.fields[listField] : null
      const items = list && list.__items ? list.__items : []
      const wants = []
      if (classesArg && typeof classesArg.length === 'number') {
        for (let i = 0; i < classesArg.length; i++) {
          const c = classesArg[i]
          if (c && c.__className) wants.push('L' + c.__className + ';')
        }
      }
      for (const a of items) {
        const d = a && a.fields ? stringValue(a.fields.desc) : ''
        if (wants.includes(d)) return { handled: true, value: a }
      }
      return { handled: true, value: null }
    }
    if (ref.cls === 'org/spongepowered/asm/util/logging/MessageRouter' && ref.name === 'getMessager') return { handled: true, value: { __class: 'javax/annotation/processing/Messager', fields: {} } }
    if (ref.cls === 'javax/annotation/processing/Messager' && ref.name === 'printMessage') return { handled: true }
    if (ref.name === 'getMessage' && ref.desc === '()Ljava/lang/String;' && recv && recv.fields) return { handled: true, value: recv.fields.detailMessage || null }
    if (ref.name === 'getStatus' && ref.desc === '()Ljava/lang/String;') return { handled: true, value: makeJavaString('default') }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/struct/MemberInfo' && ref.name === 'parse') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: 'parse', desc: ref.desc }, null)
        const rr = invoke(mm.method, null, args)
        const f = rr && rr.fields ? rr.fields : {}
        console.log('MEMBERPARSE "' + stringValue(args[0]) + '" -> ' + (rr ? 'ok' : 'null') + ' owner=' + (f.owner ? stringValue(f.owner) : '?') + ' name=' + (f.name ? stringValue(f.name) : '?') + ' desc=' + (f.desc ? stringValue(f.desc) : '?'))
        return { handled: true, value: rr }
      } catch (e) {
        const msg = e && e.__jvm ? (e.value && e.value.__class) + ':' + stringValue(e.value && e.value.fields && e.value.fields.detailMessage) : (e && e.message)
        console.log('MEMBERPARSE ERR ' + msg)
        throw e
      }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/selectors/ITargetSelector' && (ref.name === 'validate' || ref.name === 'attach')) {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: ref.name, desc: ref.desc }, recv)
        const rr = invoke(mm.method, recv, args)
        console.log('SEL.' + ref.name + ' ' + (recv && recv.__class ? recv.__class.split('/').pop() : '?') + ' -> ' + (rr ? 'ok' : 'null'))
        return { handled: true, value: rr }
      } catch (e) {
        const msg = e && e.__jvm ? (e.value && e.value.__class) + ':' + stringValue(e.value && e.value.fields && e.value.fields.detailMessage) : (e && e.message)
        console.log('SEL.' + ref.name + ' ERR ' + msg)
        throw e
      }
    }
    if (ref.name === 'addAll') console.log('ADDALL cls=' + ref.cls + ' recvItems=' + !!(recv && recv.__items) + ' argItems=' + !!(args[0] && args[0].__items) + ' argColl=' + !!(args[0] && args[0].__coll) + ' srcCls=' + (args[0] && args[0].__class) + ' srcFields=' + (args[0] && args[0].fields ? Object.keys(args[0].fields).join('|') : '-'))
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/callback/CallbackInfo') {
      if (ref.name === 'cancel') { if (recv && recv.fields) recv.fields.cancelled = 1; return { handled: true } }
      if (ref.name === 'isCancelled') { const v = recv && recv.fields && recv.fields.cancelled ? 1 : 0; console.log('ISCANCEL ' + v); return { handled: true, value: v } }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/callback/CallbackInfoReturnable') {
      if (ref.name === 'setReturnValue') { console.log('SETRET ' + args[0]); if (recv && recv.fields) { recv.fields.returnValue = args[0]; recv.fields.cancelled = 1 } return { handled: true } }
      if (ref.name === 'getReturnValue') { const rv = recv && recv.fields ? recv.fields.returnValue : null; console.log('GETRET cls=' + (rv && rv.__class) + ' keys=' + (rv && rv.fields ? Object.keys(rv.fields).join(',') : '-') + ' cancelled=' + (recv && recv.fields ? recv.fields.cancelled : 'n/a')); return { handled: true, value: rv } }
    }
    if (ref.name === 'inject' && args.length === 2 && args[1] && args[1].__items) { console.log('INJECTLIST n=' + args[1].__items.length + ' items=' + args[1].__items.map((x) => (x && x.__class ? x.__class : String(x))).join(',')); return { handled: false } }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/struct/InjectionNodes' && ref.name === 'matches' && !recv) { console.log('MATCH null at ' + currentMethod + ' recent=' + recent.slice(-6).join(' <- ')); return { handled: true, value: 0 } }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/struct/InjectionNodes' && ref.name === 'add' && args.length === 1) { let node = args[0]; const IN = 'org/spongepowered/asm/mixin/injection/struct/InjectionNodes'; if (!node || !node.__class || String(node.__class).indexOf('InjectionNode') < 0) { const wrapped = newObject(IN); wrapped.fields.originalTarget = node; wrapped.fields.currentTarget = node; wrapped.fields.id = 1; node = wrapped } if (!recv.__items) recv.__items = []; recv.__items.push(node); return { handled: true, value: ref.desc === '(Ljava/lang/Object;)Z' ? 1 : node } }
    if (ref.cls === 'org/spongepowered/asm/mixin/injection/struct/InjectionNodes' && ref.name === 'isRemoved') { if (!recv || typeof recv !== 'object') console.log('ISREMOVED recv=' + recv + ' at ' + currentMethod + ' recent=' + recent.slice(-8).join(' <- ')); return { handled: false } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinProcessor' && (ref.name === 'applyMixins' || ref.name === 'selectConfigs') && recv && !recv.__pid) recv.__pid = (globalThis.__pidSeq = (globalThis.__pidSeq || 0) + 1)
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinTransformer' && ref.name === '<init>') console.log('NEW TRANSFORMER at ' + currentMethod)
    if (ref.name === 'prepareConfigs' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinProcessor') {
      try {
        const sz = (l) => (l && l.__items ? l.__items.length : (l && l.fields && typeof l.fields.size === 'number' ? l.fields.size : '?'))
        const before = 'c=' + sz(recv.fields.configs) + '/p=' + sz(recv.fields.pendingConfigs)
        const mm = resolveMethod({ cls: ref.cls, name: 'prepareConfigs', desc: ref.desc }, recv)
        const rr = invoke(mm.method, recv, args)
        console.log('PREPARECONFIGS ' + before + ' ret=' + rr + ' after c=' + sz(recv.fields.configs) + '/p=' + sz(recv.fields.pendingConfigs))
        return { handled: true, value: rr }
      } catch (e) { if (e && e.missingClass) throw e; console.log('PREPARECONFIGS ERR ' + (e && e.message)) }
    }
    if (ref.name === 'selectConfigs') console.log('SELECTCONFIGS pid=' + (recv && recv.__pid ? recv.__pid : '?'))
    if (ref.cls === 'org/spongepowered/asm/mixin/Mixins' && ref.name === 'getConfigs') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: 'getConfigs', desc: ref.desc }, null)
        const rr = invoke(mm.method, null, [])
        const n = rr && rr.__items ? rr.__items.length : (rr && rr.items ? rr.items.length : '?')
        console.log('GETCONFIGS n=' + n)
        return { handled: true, value: rr }
      } catch (e) { if (e && e.missingClass) throw e; console.log('GETCONFIGS ERR ' + e.message) }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinConfig' && ref.name === 'select') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: 'select', desc: ref.desc }, recv)
        const rr = invoke(mm.method, recv, args)
        console.log('CFGSELECT cid=' + cid(recv) + ' ret=' + rr + ' sameEnv=' + (recv.fields.env === args[0]) + ' envNull=' + (recv.fields.env == null))
        return { handled: true, value: rr }
      } catch (e) { if (e && e.missingClass) throw e; console.log('CFGSELECT ERR ' + e.message) }
    }
    if (ref.name === 'applyMixins' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinProcessor') {
      const c = recv && recv.fields && recv.fields.configs
      const p = recv && recv.fields && recv.fields.pendingConfigs
      const sz = (l) => (l && l.__items ? l.__items.length : (l && l.fields && typeof l.fields.size === 'number' ? l.fields.size : '?'))
      console.log('APPLY ' + stringValue(args[1]) + ' configs=' + sz(c) + ' pending=' + sz(p) + ' pid=' + (recv && recv.__pid ? recv.__pid : '?'))
    }
    if (ref.name === 'hasMixinsFor' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinConfig') {
      try {
        const mm = resolveMethod({ cls: ref.cls, name: 'hasMixinsFor', desc: ref.desc }, recv)
        const rr = invoke(mm.method, recv, args)
        console.log('HASMIX cid=' + cid(recv) + ' ' + stringValue(args[0]) + ' ret=' + rr)
        return { handled: true, value: rr }
      } catch (e) { if (e && e.missingClass) throw e; console.log('HASMIX ERR ' + e.message) }
    }
    if (ref.name === 'hasMixinsFor') console.log('HASMIX ' + stringValue(args[0]))
    if (ref.name === 'mixinsFor' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinConfig') console.log('MIXINSFOR cid=' + cid(recv) + ' ' + stringValue(args[0]))
    if (ref.name === 'getMixinsFor') console.log('GETMIX ' + stringValue(args[0]))
    if (ref.name === 'prepare' && ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinConfig') console.log('CFGPREPARE prepared=' + (recv && recv.fields ? recv.fields.prepared : '?'))
    if (ref.name === 'addMixin') console.log('ADDMIXIN recv=' + (recv && recv.__class) + ' name=' + (recv && recv.fields && recv.fields.name ? stringValue(recv.fields.name) : '?'))
    if (ref.name === 'getTargetClasses') console.log('GT raw cls=' + ref.cls + ' fields=' + !!(recv && recv.fields && recv.fields.targetClasses))
    traceIn(ref.cls, ref.name, ref.desc, args)
    if (ref.cls === 'java/util/concurrent/ConcurrentHashMap' && ref.name === '<init>') {
      recv.__chm = true
      recv.__map = new Map()
      return { handled: true }
    }
    if (recv && ref.cls === 'java/util/concurrent/ConcurrentHashMap' && (ref.name === 'putVal' || ref.name === 'put' || ref.name === 'get' || ref.name === 'getOrDefault' || ref.name === 'remove' || ref.name === 'containsKey')) {
      if (!recv.__chm) { recv.__chm = true; recv.__map = new Map() }
      const m = recv.__map
      const key = args[0]
      if (ref.name === 'putVal') {
        const onlyIfAbsent = args[2] ? 1 : 0
        if (onlyIfAbsent && m.has(key)) return { handled: true, value: m.get(key) }
        const old = m.get(key)
        m.set(key, args[1])
        return { handled: true, value: old === undefined ? null : old }
      }
    }
    if (recv && recv.__chm) {
      const name = ref.name
      const m = recv.__map
      if (name === 'put') { const k = args[0] && args[0].__class === 'java/lang/String' ? stringValue(args[0]) : args[0]; const old = m.get(k); m.set(k, args[1]); return { handled: true, value: old === undefined ? null : old } }
      if (name === 'get') { const k = args[0] && args[0].__class === 'java/lang/String' ? stringValue(args[0]) : args[0]; const v = m.get(k); return { handled: true, value: v === undefined ? null : v } }
      if (name === 'putIfAbsent') { if (!m.has(args[0])) { m.set(args[0], args[1]); return { handled: true, value: null } } return { handled: true, value: m.get(args[0]) } }

      if (name === 'getOrDefault') { return { handled: true, value: m.has(args[0]) ? m.get(args[0]) : args[1] } }
      if (name === 'containsKey') { const k = args[0] && args[0].__class === 'java/lang/String' ? stringValue(args[0]) : args[0]; return { handled: true, value: m.has(k) ? 1 : 0 } }
      if (name === 'containsValue') { for (const v of m.values()) if (v === args[0]) return { handled: true, value: 1 }; return { handled: true, value: 0 } }
      if (name === 'remove') { const had = m.has(args[0]); const old = m.get(args[0]); m.delete(args[0]); return { handled: true, value: had ? old : null } }
      if (name === 'size') return { handled: true, value: m.size }
      if (name === 'isEmpty') return { handled: true, value: m.size === 0 ? 1 : 0 }
      if (name === 'clear') { m.clear(); return { handled: true } }
      if (name === 'keySet') return { handled: true, value: { __chmView: 'keys', map: m } }
      if (name === 'values') return { handled: true, value: { __chmView: 'values', map: m } }
      if (name === 'entrySet') return { handled: true, value: { __chmView: 'entries', map: m } }
    }
    if (recv && recv.__chmView) {
      const map = recv.map
      const items = recv.__chmView === 'keys' ? Array.from(map.keys()) : recv.__chmView === 'values' ? Array.from(map.values()) : Array.from(map.entries()).map(([k, v]) => ({ __entry: true, key: k, value: v }))
      const name = ref.name
      if (name === 'size') return { handled: true, value: items.length }
      if (name === 'isEmpty') return { handled: true, value: items.length === 0 ? 1 : 0 }
      if (name === 'iterator') return { handled: true, value: { __chmIter: true, items, i: 0 } }
      if (name === 'contains') return { handled: true, value: items.includes(args[0]) ? 1 : 0 }
      if (name === 'toArray') { const arr = items.slice(); arr.__array = true; return { handled: true, value: arr } }
    }
    if (recv && recv.__chmIter) {
      if (ref.name === 'hasNext') return { handled: true, value: recv.i < recv.items.length ? 1 : 0 }
      if (ref.name === 'next') return { handled: true, value: recv.items[recv.i++] }
      if (ref.name === 'remove') return { handled: true }
    }
    if (recv && recv.__entry) {
      if (ref.name === 'getKey') return { handled: true, value: recv.key }
      if (ref.name === 'getValue') return { handled: true, value: recv.value }
      if (ref.name === 'setValue') { recv.value = args[0]; return { handled: true, value: args[0] } }
    }
    if (recv && recv.__typeName && (ref.name === 'getTypeName' || ref.name === 'toString')) {
      return { handled: true, value: makeJavaString(recv.__typeName) }
    }
    if (ref.name === 'clone' && Array.isArray(recv)) {      const copy = recv.slice()
      copy.__array = true
      if (recv.__class) copy.__class = recv.__class
      return { handled: true, value: copy }
    }
    if (
      ref.cls.indexOf('org/lwjgl/opengl/') === 0 &&
      glHooks &&
      !['glBegin', 'glEnd', 'glVertex2f', 'glColor3f'].includes(ref.name)
    ) {
      const name = ref.name
      let value
      if (name === 'glCreateShader') value = glHooks.createShader(args[0])
      else if (name === 'glShaderSource') glHooks.shaderSource(args[0], stringValue(args[1]))
      else if (name === 'glCompileShader') glHooks.compileShader(args[0])
      else if (name === 'glCreateProgram') value = glHooks.createProgram()
      else if (name === 'glAttachShader') glHooks.attachShader(args[0], args[1])
      else if (name === 'glLinkProgram') glHooks.linkProgram(args[0])
      else if (name === 'glUseProgram') glHooks.useProgram(args[0])
      else if (name === 'glGetUniformLocation') value = glHooks.getUniformLocation(args[0], stringValue(args[1]))
      else if (name === 'glUniformMatrix4fv') {
        const data = args[2] && args[2].__buffer ? args[2].__data.slice(0, 16) : args[2]
        glHooks.uniformMatrix4fv(args[0], args[1], data)
      }
      else if (name === 'glUniform1i') glHooks.uniform1i(args[0], args[1])
      else if (name === 'glGenTextures') value = glHooks.genTextures()
      else if (name === 'glBindTexture') glHooks.bindTexture(args[0], args[1])
      else if (name === 'glTexParameteri') glHooks.texParameteri(args[0], args[1], args[2])
      else if (name === 'glTexImage2D') {
        const pixels = args[8] && args[8].__buffer ? args[8].__data.slice(0, args[8].__limit) : args[8]
        glHooks.texImage2D(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], pixels)
      }
      else if (name === 'glActiveTexture') glHooks.activeTexture(args[0])
      else if (name === 'glGenerateMipmap') glHooks.generateMipmap(args[0])
      else if (name === 'glGetAttribLocation') value = glHooks.getAttribLocation(args[0], stringValue(args[1]))
      else if (name === 'glEnableVertexAttribArray') glHooks.enableVertexAttribArray(args[0])
      else if (name === 'glVertexAttribPointer') glHooks.vertexAttribPointer(args[0], args[1], args[2], args[3], args[4], args[5])
      else if (name === 'glGenBuffers') value = glHooks.genBuffers()
      else if (name === 'glBindBuffer') glHooks.bindBuffer(args[0], args[1])
      else if (name === 'glBufferData') glHooks.bufferData(args[0], Array.from(args[1] || []), args[2])
      else if (name === 'glDrawArrays') glHooks.drawArrays(args[0], args[1], args[2])
      else if (name === 'glDrawElements') glHooks.drawElements(args[0], args[1], args[2], args[3])
      else if (name === 'glClear') glHooks.clear(args[0])
      else if (name === 'glClearColor') glHooks.clearColor(args[0], args[1], args[2], args[3])
      else if (name === 'glEnable' || name === 'glDisable' || name === 'glFlush' || name === 'glFinish') return { handled: true }
      else if (name === 'glViewport') glHooks.viewport(args[0], args[1], args[2], args[3])
      else if (name === 'glBlendFunc' || name === 'glDepthFunc' || name === 'glCullFace' || name === 'glFrontFace') return { handled: true }
      else throw new Error('GL bridge not implemented: ' + name)
      if (retKind(ref.desc) !== 'v') return { handled: true, value }
      return { handled: true }
    }
    if (ref.cls === 'sun/misc/Unsafe' || ref.cls === 'jdk/internal/misc/Unsafe') {
      const name = ref.name
      if (name === 'addressSize') return { handled: true, value: 8 }
      if (name === 'arrayBaseOffset') return { handled: true, value: 16 }
      if (name === 'arrayIndexScale') return { handled: true, value: 1 }
      if (name === 'allocateInstance') {
        const className = args[0].__className
        if (String(className).indexOf('MixinConfig') >= 0) console.log('UNSAFE ALLOC ' + className)
        if (!classes.has(className)) throw new MissingClassError(className)
        ensureInit(className)
        const obj = newObject(className)
        if (className === 'org/spongepowered/asm/mixin/transformer/MixinConfig') { obj.fields.name = makeJavaString('mixins.test.json'); obj.fields.initialised = 0; obj.fields.prepared = 0; obj.fields.visited = 0 }
        return { handled: true, value: obj }
      }
      if (name === 'ensureClassInitialized') {
        ensureInit(args[0].__className)
        return { handled: true }
      }
      if (name === 'objectFieldOffset' || name === 'staticFieldOffset') {
        const fld = args[0]
        const id = nextFieldOffset++
        fieldOffsets.set(id, { owner: fld.__owner, name: fld.__name, static: fld.__static })
        return { handled: true, value: id }
      }
      if (name.startsWith('get')) {
        const meta = fieldOffsets.get(args[1])
        if (!meta) throw new Error('bad field offset ' + args[1] + ' ' + name + ' recv=' + (args[0] && args[0].__class) + ' recent=' + recent.slice(-8).join(' <- '))
        if (meta.static) return { handled: true, value: staticField(meta.owner, meta.name) }
        return { handled: true, value: args[0].fields[meta.name] }
      }
      if (name.startsWith('put')) {
        const meta = fieldOffsets.get(args[1])
        if (!meta) throw new Error('bad field offset ' + args[1] + ' ' + name + ' recv=' + (args[0] && args[0].__class) + ' recent=' + recent.slice(-8).join(' <- '))
        if (meta.static) setStaticField(meta.owner, meta.name, args[2])
        else args[0].fields[meta.name] = args[2]
        return { handled: true }
      }
    }
    if (ref.cls === 'sun/nio/cs/StreamDecoder' && ref.name === '<init>') { recv.__stream = args[0]; return { handled: true } }
    if (ref.cls === 'sun/nio/cs/StreamDecoder' && (ref.name === 'close' || ref.name === 'available' || ref.name === 'ready')) return { handled: true, value: ref.name === 'available' ? 0 : 1 }
    if (ref.cls === 'sun/nio/cs/StreamDecoder' && ref.name === 'read') {
      const readOne = () => { try { const m = resolveMethod({ cls: 'java/io/InputStream', name: 'read', desc: '()I' }, recv.__stream); return invoke(m.method, recv.__stream, []) } catch (e) { return -1 } }
      if (args.length === 0) return { handled: true, value: readOne() }
      const buf = args[0]; const off = args[1] | 0; const len = args[2] | 0
      let n = 0
      while (n < len) { const b = readOne(); if (b < 0) break; buf[off + n] = b; n++ }
      return { handled: true, value: n === 0 ? -1 : n }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment$CompatibilityLevel' && ref.name === 'isLessThan') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment$CompatibilityLevel' && ref.name === 'isAtLeast') return { handled: true, value: 1 }
    if (ref.cls === 'java/lang/StackTraceElement' && (ref.name === 'getClassName' || ref.name === 'getMethodName' || ref.name === 'getFileName')) return { handled: true, value: makeJavaString('') }
    if (ref.cls === 'java/lang/StackTraceElement' && (ref.name === 'getLineNumber')) return { handled: true, value: 0 }
    if (ref.cls === 'java/lang/Character' && ref.name === 'digit') { const ch = args[0]; const r = args[1] || 10; const d = parseInt(String.fromCharCode(ch), r); return { handled: true, value: isNaN(d) ? -1 : d } }
    if (ref.cls === 'java/lang/Character' && ref.name === 'isDigit') { const ch = args[0]; return { handled: true, value: ch >= 48 && ch <= 57 ? 1 : 0 } }
    if (ref.cls === 'java/util/regex/Pattern' && ref.name === 'compile') {
      let src = stringValue(args[0])
      let fl = ''
      let guard = 0
      while (src.startsWith('(?') && guard++ < 5) {
        const m = /^\(\?([idmsux]+)\)/.exec(src)
        if (!m) break
        for (const c of m[1]) { if ('dmsiu'.includes(c) && !fl.includes(c)) fl += c }
        src = src.slice(m[0].length)
      }
      if (/\\p\{|\\P\{/.test(src) && !fl.includes('u')) fl += 'u'
      return { handled: true, value: { __class: 'java/util/regex/Pattern', __pattern: true, regex: src, regexFlags: fl, fields: { pattern: args[0] } } }
    }
    if (recv && recv.__pattern && ref.name === 'matcher') return { handled: true, value: { __class: 'java/util/regex/Matcher', __matcher: true, regex: recv.regex, regexFlags: recv.regexFlags || '', text: stringValue(args[0]), pos: 0, match: null, fields: { first: 0, last: 0 } } }
    if (recv && recv.__matcher) {
      const mflags = recv.regexFlags || ''
      if (ref.name === 'matches') { let m = null; try { m = new RegExp('^(?:' + recv.regex + ')$', mflags).exec(recv.text) } catch (e) { console.log('MATCHES compile fail regex=' + recv.regex + ' flags=' + mflags) } if (!m) console.log('MATCHES fail regex=' + recv.regex + ' flags=' + mflags + ' text=' + recv.text); recv.match = m; recv.pos = m ? m.index + m[0].length : 0; return { handled: true, value: m ? 1 : 0 } }
      if (ref.name === 'find') { let re = null; try { re = new RegExp(recv.regex, mflags + 'g') } catch (e) {} if (!re) return { handled: true, value: 0 }; if (recv.pos == null) recv.pos = 0; re.lastIndex = recv.pos; const m = re.exec(recv.text); if (!m) { recv.match = null; recv.pos = recv.text.length; return { handled: true, value: 0 } } recv.match = m; recv.pos = m.index + (m[0].length || 1); return { handled: true, value: 1 } }
      if (ref.name === 'groupCount') return { handled: true, value: recv.match ? recv.match.length - 1 : 0 }
      if (ref.name === 'group') { const gi = args.length ? args[0] | 0 : 0; const g = recv.match ? recv.match[gi] : null; return { handled: true, value: g == null ? null : makeJavaString(g) } }
      if (ref.name === 'start') return { handled: true, value: recv.match ? recv.match.index : -1 }
      if (ref.name === 'end') return { handled: true, value: recv.match ? recv.match.index + recv.match[0].length : -1 }
      if (ref.name === 'reset') { recv.pos = 0; recv.match = null; return { handled: true, value: recv } }
      if (ref.name === 'replaceAll' || ref.name === 'replaceFirst') { try { const re = new RegExp(recv.regex, ref.name === 'replaceAll' ? mflags + 'g' : mflags); return { handled: true, value: makeJavaString(recv.text.replace(re, stringValue(args[0]))) } } catch (e) { return { handled: true, value: makeJavaString(recv.text) } } }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'isLessThan') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'isAtLeast') return { handled: true, value: 1 }
    if (ref.cls === 'java/lang/StackTraceElement' && ref.name === 'of') { const e = []; e.__array = true; return { handled: true, value: e } }
    if (ref.cls === 'java/lang/Throwable' && (ref.name === 'getOurStackTrace' || ref.name === 'getStackTrace')) { const e = []; e.__array = true; return { handled: true, value: e } }
    if (ref.cls === 'java/lang/Integer' && ref.name === 'parseInt') { const m = /^[+-]?\\d+/.exec(stringValue(args[0])); return { handled: true, value: m ? parseInt(m[0], 10) : 0 } }
    if (ref.cls === 'java/lang/Long' && ref.name === 'parseLong') { const m = /^[+-]?\\d+/.exec(stringValue(args[0])); return { handled: true, value: m ? parseInt(m[0], 10) : 0 } }
    if (ref.cls === 'java/lang/Boolean' && ref.name === 'booleanValue') return { handled: true, value: recv === true || (recv && recv.fields && recv.fields.value) ? 1 : 0 }
    if (ref.cls === 'java/lang/Boolean' && (ref.name === 'valueOf' || ref.name === 'parseBoolean')) return { handled: true, value: args[0] === true || stringValue(args[0]) === 'true' ? 1 : 0 }
    if ((ref.cls === 'java/lang/Integer' || ref.cls === 'java/lang/Long' || ref.cls === 'java/lang/Short' || ref.cls === 'java/lang/Byte') && (ref.name === 'intValue' || ref.name === 'longValue' || ref.name === 'shortValue' || ref.name === 'byteValue')) return { handled: true, value: Number(recv) | 0 }
    if ((ref.cls === 'java/lang/Float' || ref.cls === 'java/lang/Double') && (ref.name === 'floatValue' || ref.name === 'doubleValue')) return { handled: true, value: Number(recv) }
    if (ref.cls === 'java/lang/Character' && ref.name === 'charValue') return { handled: true, value: typeof recv === 'number' ? recv : 0 }
    if (ref.cls === 'java/lang/ThreadLocal') {
      if (ref.name === 'get') return { handled: true, value: recv && recv.__tl !== undefined ? recv.__tl : null }
      if (ref.name === 'set') { if (recv) recv.__tl = args[0]; return { handled: true } }
      if (ref.name === 'remove') { if (recv) recv.__tl = undefined; return { handled: true } }
    }
    if (ref.cls === 'java/io/InputStreamReader' && ref.name === '<init>') { recv.__stream = args[0]; return { handled: true } }
    if (ref.cls === 'java/io/InputStreamReader' && ref.name === 'read') {
      const readOne = () => { try { const m = resolveMethod({ cls: 'java/io/InputStream', name: 'read', desc: '()I' }, recv.__stream); return invoke(m.method, recv.__stream, []) } catch (e) { return -1 } }
      if (args.length === 0) return { handled: true, value: readOne() }
      const buf = args[0]; const off = args[1] | 0; const len = args[2] | 0
      let n = 0
      while (n < len) { const b = readOne(); if (b < 0) break; buf[off + n] = b; n++ }
      return { handled: true, value: n === 0 ? -1 : n }
    }
    if (ref.cls === 'java/util/concurrent/atomic/AtomicInteger') {
      if (ref.name === 'getAndAddInt' || ref.name === 'getAndAdd') { const old = recv.fields.value | 0; recv.fields.value = old + (args[1] | 0); return { handled: true, value: old } }
      if (ref.name === 'getAndSet') { const old = recv.fields.value | 0; recv.fields.value = args[0] | 0; return { handled: true, value: old } }
      if (ref.name === 'compareAndSet') { const old = recv.fields.value | 0; if (old === (args[0] | 0)) { recv.fields.value = args[1] | 0; return { handled: true, value: 1 } } return { handled: true, value: 0 } }
      if (ref.name === 'get') return { handled: true, value: recv.fields.value | 0 }
      if (ref.name === 'set') { recv.fields.value = args[0] | 0; return { handled: true } }
      if (ref.name === 'incrementAndGet') { recv.fields.value = (recv.fields.value | 0) + 1; return { handled: true, value: recv.fields.value } }
      if (ref.name === 'decrementAndGet') { recv.fields.value = (recv.fields.value | 0) - 1; return { handled: true, value: recv.fields.value } }
    }
    if (ref.cls === 'org/lwjgl/BufferUtils') {
      const cap = args[0] | 0
      if (ref.name === 'createFloatBuffer') {
        return { handled: true, value: { __buffer: true, __type: 'float', __data: new Array(cap).fill(0), __pos: 0, __limit: cap } }
      }
      if (ref.name === 'createByteBuffer') {
        return { handled: true, value: { __buffer: true, __type: 'byte', __data: new Array(cap).fill(0), __pos: 0, __limit: cap } }
      }
    }
    if (recv && recv.__buffer) {
      if (ref.name === 'put') {
        if (Array.isArray(args[0])) {
          for (const v of args[0]) recv.__data[recv.__pos++] = v
        } else if (typeof args[0] === 'number') {
          recv.__data[recv.__pos++] = args[0]
        }
        return { handled: true, value: recv }
      }
      if (ref.name === 'flip') {
        recv.__limit = recv.__pos
        recv.__pos = 0
        return { handled: true, value: recv }
      }
      if (ref.name === 'rewind') {
        recv.__pos = 0
        return { handled: true, value: recv }
      }
      if (ref.name === 'clear') {
        recv.__pos = 0
        recv.__limit = recv.__data.length
        return { handled: true, value: recv }
      }
      if (ref.name === 'position') {
        if (args.length === 0) return { handled: true, value: recv.__pos }
        recv.__pos = args[0] | 0
        return { handled: true, value: recv }
      }
      if (ref.name === 'limit') {
        recv.__limit = args[0] | 0
        return { handled: true, value: recv }
      }
      if (ref.name === 'remaining') return { handled: true, value: recv.__limit - recv.__pos }
      if (ref.name === 'capacity') return { handled: true, value: recv.__data.length }
    }
    if (ref.cls === 'org/lwjgl/opengl/GL11' && glHooks) {
      if (ref.name === 'glClearColor') return { handled: true, value: void glHooks.clearColor(args[0], args[1], args[2], args[3]) }
      if (ref.name === 'glClear') return { handled: true, value: void glHooks.clear(args[0]) }
      if (ref.name === 'glBegin') return { handled: true, value: void glHooks.begin(args[0]) }
      if (ref.name === 'glColor3f') return { handled: true, value: void glHooks.color3f(args[0], args[1], args[2]) }
      if (ref.name === 'glVertex2f') return { handled: true, value: void glHooks.vertex2f(args[0], args[1]) }
      if (ref.name === 'glEnd') return { handled: true, value: void glHooks.end() }
    }
    if (ref.cls === 'java/lang/reflect/Array' && ref.name === 'newInstance') {
      const comp = args[0] && args[0].__className
      const len = args[1] | 0
      const prim = ['int','long','boolean','byte','char','short','float','double']
      const arr = new Array(len).fill(prim.includes(comp) ? 0 : null)
      arr.__array = true
      if (comp && !prim.includes(comp)) arr.__class = '[L' + comp + ';'
      return { handled: true, value: arr }
    }
    if (ref.cls === 'java/lang/reflect/Array' && (ref.name === 'getLength')) {
      return { handled: true, value: args[0].length }
    }
    if (ref.cls === 'java/lang/Object') {
      if (ref.name === 'hashCode') {
        if (recv == null) return { handled: true, value: 0 }
        if (typeof recv !== 'object') return { handled: true, value: String(recv).length }
        if (!hashIds.has(recv)) hashIds.set(recv, nextHash++)
        return { handled: true, value: hashIds.get(recv) }
      }
      if (ref.name === 'equals') return { handled: true, value: recv === args[0] ? 1 : 0 }
      if (ref.name === 'toString') {
        const cls = recv && recv.__class ? recv.__class : 'java/lang/Object'
        return { handled: true, value: makeJavaString(cls + '@' + (recv && recv.__hash ? recv.__hash : '0')) }
      }
    }
    if (ref.cls === 'java/lang/Thread') {
      if (ref.name === 'currentThread') return { handled: true, value: pseudoThread }
      if (ref.name === 'getContextClassLoader') return { handled: true, value: { __class: 'java/lang/ClassLoader' } }
    }
    if (ref.cls === 'java/lang/Module') {
      if (ref.name === 'isNamed') return { handled: true, value: 0 }
      if (ref.name === 'getName') return { handled: true, value: makeJavaString('') }
      if (ref.name === 'getLayer') return { handled: true, value: null }
      if (ref.name === 'getClassLoader') return { handled: true, value: { __class: 'java/lang/ClassLoader' } }
      if (ref.name === 'getModule') return { handled: true, value: pseudoModule }
    }
    if (ref.cls === 'java/lang/reflect/Constructor') {
      if (ref.name === 'setAccessible' || ref.name === 'trySetAccessible') return { handled: true, value: 1 }
      if (ref.name === 'getParameterTypes') return { handled: true, value: paramsFromDesc(recv.__desc) }
      if (ref.name === 'getParameterCount') return { handled: true, value: argCount(recv.__desc) }
      if (ref.name === 'newInstance') {
        if (String(recv.__owner).indexOf('MixinConfig') >= 0) console.log('CTOR NEW ' + recv.__owner)
        const obj = newObject(recv.__owner)
        if (String(recv.__owner).indexOf('MixinConfig') >= 0) { obj.fields.name = makeJavaString('mixins.test.json'); obj.fields.initialised = 0; obj.fields.prepared = 0; obj.fields.visited = 0 }
        const params = args[0] ? Array.from(args[0]) : []
        const ctor = resolveMethod({ cls: recv.__owner, name: '<init>', desc: recv.__desc }, obj)
        invoke(ctor.method, obj, params)
        return { handled: true, value: obj }
      }
    }
    if (ref.cls === 'java/util/ServiceLoader' && (ref.name === 'load' || ref.name === 'loadInstalled')) {
      const serviceName = args[0] && args[0].__className
      const items = []
      if (serviceName === 'org/spongepowered/asm/service/IGlobalPropertyService') items.push({ __props: true, map: new Map() })
      return { handled: true, value: { __svc: true, items } }
    }
    if (recv && recv.__props) {
      if (ref.name === 'resolveKey') return { handled: true, value: { __propKey: true, name: stringValue(args[0]) } }
      if (ref.name === 'getProperty') { const k = args[0] && args[0].name; if (recv.map.has(k)) return { handled: true, value: recv.map.get(k) }; return { handled: true, value: args.length > 1 ? args[1] : null } }
      if (ref.name === 'setProperty') { recv.map.set(args[0] && args[0].name, args[1]); return { handled: true } }
      if (ref.name === 'getPropertyString') { const k = args[0] && args[0].name; return { handled: true, value: recv.map.has(k) ? makeJavaString(String(recv.map.get(k))) : args[1] } }
    }
    if (recv && recv.__svc) {
      if (ref.name === 'iterator') return { handled: true, value: { __svcIter: true, items: recv.items, i: 0 } }
      if (ref.name === 'reload') return { handled: true }
      if (ref.name === 'findFirst') return { handled: true, value: null }
    }
    if (recv && recv.__svcIter) {
      if (ref.name === 'hasNext') return { handled: true, value: recv.i < recv.items.length ? 1 : 0 }
      if (ref.name === 'next') return { handled: true, value: recv.items[recv.i++] }
    }
    if (ref.cls === 'java/nio/file/spi/FileSystemProvider' && ref.name === 'readAttributes') return { handled: true, value: { __attrs: true } }
    if (recv && recv.__attrs) {
      if (ref.name === 'isDirectory') return { handled: true, value: 1 }
      if (ref.name === 'isRegularFile' || ref.name === 'isSymbolicLink') return { handled: true, value: 0 }
      if (ref.name === 'size') return { handled: true, value: 0 }
      if (ref.name === 'lastModifiedTime' || ref.name === 'creationTime' || ref.name === 'lastAccessTime') return { handled: true, value: null }
    }
    if (ref.cls === 'java/nio/file/spi/FileSystemProvider' && ref.name === 'newDirectoryStream') return { handled: true, value: { __dirStream: true } }
    if (recv && recv.__dirStream) {
      if (ref.name === 'iterator') return { handled: true, value: { __chmIter: true, items: [], i: 0 } }
      if (ref.name === 'close') return { handled: true }
    }
    if (ref.cls === 'java/util/logging/Logger' && (ref.name === 'getLogger' || ref.name === 'getAnonymousLogger')) return { handled: true, value: { __jul: true } }
    if (recv && recv.__jul) {
      if (ref.name === 'isLoggable') return { handled: true, value: 0 }
      if (ref.name === 'getName') return { handled: true, value: makeJavaString('') }
      if (ref.name === 'log' || ref.name === 'info' || ref.name === 'warning' || ref.name === 'fine' || ref.name === 'finer' || ref.name === 'finest' || ref.name === 'config' || ref.name === 'severe' || ref.name === 'entering' || ref.name === 'exiting' || ref.name === 'throwing') return { handled: true }
    }
    if (ref.cls === 'java/nio/file/Files' && (ref.name === 'delete' || ref.name === 'deleteIfExists' || ref.name === 'createDirectory' || ref.name === 'createDirectories' || ref.name === 'createFile' || ref.name === 'move' || ref.name === 'copy' || ref.name === 'write')) return { handled: true }
    if (ref.cls === 'java/nio/file/Files' && ref.name === 'exists') return { handled: true, value: 0 }
    if (ref.cls === 'java/nio/file/Files' && ref.name === 'isDirectory') return { handled: true, value: 1 }
    if (ref.cls === 'java/nio/file/Files' && ref.name === 'isRegularFile') return { handled: true, value: 0 }
    if (ref.cls === 'java/nio/file/Files' && ref.name === 'newOutputStream') return { handled: true, value: { __out: true } }
    if (recv && recv.__out) { if (ref.name === 'write') return { handled: true }; if (ref.name === 'close' || ref.name === 'flush') return { handled: true } }
    if (ref.cls === 'java/nio/file/Files' && ref.name === 'provider') return { handled: true, value: { __class: 'java/nio/file/spi/FileSystemProvider' } }
    if (ref.name === 'getPath' && ref.cls && (ref.cls.indexOf('FileSystem') >= 0)) {
      const p = args.length > 1 ? stringValue(args[1]) : stringValue(args[0])
      return { handled: true, value: { __class: 'java/nio/file/Path', __path: p } }
    }
    if (ref.cls && ref.cls.startsWith('sun/nio/fs/') && ref.name === 'getPath') {
      const p = args.length > 1 ? stringValue(args[1]) : stringValue(args[0])
      return { handled: true, value: { __class: 'java/nio/file/Path', __path: p } }
    }
    if (ref.cls === 'java/nio/file/Paths' && (ref.name === 'get')) {
      const parts = []
      for (let i = 0; i < args.length; i++) parts.push(stringValue(args[i]))
      return { handled: true, value: { __class: 'java/nio/file/Path', __path: parts.join('/') } }
    }
    if (recv && recv.__class === 'java/nio/file/Path') {
      if (ref.name === 'toString' || ref.name === 'toAbsolutePath' || ref.name === 'normalize') return { handled: true, value: recv }
      if (ref.name === 'getFileName') return { handled: true, value: { __class: 'java/nio/file/Path', __path: recv.__path.split('/').pop() } }
      if (ref.name === 'getParent') return { handled: true, value: { __class: 'java/nio/file/Path', __path: recv.__path.split('/').slice(0, -1).join('/') } }
      if (ref.name === 'toFile') return { handled: true, value: { __class: 'java/io/File', __path: recv.__path } }
      if (ref.name === 'getFileSystem') return { handled: true, value: { __class: 'java/nio/file/FileSystem' } }
      if (ref.name === 'toUri') return { handled: true, value: { __class: 'java/net/URI', __text: 'file:///' + recv.__path } }
      if (ref.name === 'getNameCount') return { handled: true, value: recv.__path.split('/').filter(Boolean).length }
      if (ref.name === 'getRoot') return { handled: true, value: null }
      if (ref.name === 'resolve') return { handled: true, value: { __class: 'java/nio/file/Path', __path: recv.__path + '/' + stringValue(args[0]) } }
    }
    if (ref.cls === 'java/util/Objects' && ref.name === 'requireNonNull') {
      if (args[0] == null) throw new Error('NPE requireNonNull at ' + currentMethod + ' recent=' + recent.slice(-10).join(' <- '))
      return { handled: true, value: args[0] }
    }
    if (ref.cls === 'java/io/FileSystem' && ref.name === 'normalize') return { handled: true, value: args[0] }
    if (ref.cls === 'java/io/File' && ref.name === '<init>') {
      const parent = args[0] ? stringValue(args[0]) : ''
      const child = args[1] !== undefined ? stringValue(args[1]) : ''
      recv.__path = parent && child ? parent.replace(/[\\\\/]+$/, '') + '/' + child : (child || parent)
      return { handled: true }
    }
    if (ref.cls === 'java/io/File') {
      if (ref.name === 'getPath' || ref.name === 'toString' || ref.name === 'getAbsolutePath' || ref.name === 'getCanonicalPath') return { handled: true, value: makeJavaString(recv.__path || '') }
      if (ref.name === 'getName') return { handled: true, value: makeJavaString((recv.__path || '').split(/[\\\\/]/).pop()) }
      if (ref.name === 'exists' || ref.name === 'isFile') return { handled: true, value: 0 }
      if (ref.name === 'isDirectory') return { handled: true, value: 1 }
      if (ref.name === 'lastModified') return { handled: true, value: 0 }
    }
    if (ref.cls === 'java/util/UUID' && ref.name === 'toString') {
      const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
      return { handled: true, value: makeJavaString(hex() + '-' + hex().slice(0, 4) + '-' + hex().slice(0, 4) + '-' + hex().slice(0, 4) + '-' + hex() + hex().slice(0, 4)) }
    }
    if (ref.cls === 'java/security/SecureRandom' && ref.name === 'nextBytes') {
      const arr = args[0]
      if (arr) for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0
      return { handled: true }
    }
    if (ref.cls === 'java/util/Collections' && ref.name === 'emptyIterator') return { handled: true, value: { __chmIter: true, items: [], i: 0 } }
    if (ref.cls === 'java/util/Collections' && (ref.name === 'emptyList' || ref.name === 'emptySet')) return { handled: true, value: { __coll: true, items: [] } }
    if (ref.cls === 'java/util/Collections' && ref.name === 'emptyMap') return { handled: true, value: { __chm: true, __map: new Map() } }
    if (recv && recv.__coll) {
      if (ref.name === 'size') return { handled: true, value: recv.items.length }
      if (ref.name === 'isEmpty') return { handled: true, value: recv.items.length ? 0 : 1 }
      if (ref.name === 'iterator') return { handled: true, value: { __chmIter: true, items: recv.items, i: 0 } }
      if (ref.name === 'contains') return { handled: true, value: recv.items.includes(args[0]) ? 1 : 0 }
      if (ref.name === 'get' && typeof args[0] === 'number') return { handled: true, value: recv.items[args[0] | 0] }
      if (ref.name === 'toArray') { const a = recv.items.slice(); a.__array = true; return { handled: true, value: a } }
    }
    if (ref.cls === 'java/net/URL') {
      if (ref.name === 'toExternalForm' || ref.name === 'toString') return { handled: true, value: makeJavaString(recv && recv.__url ? recv.__url : 'file:/') }
      if (ref.name === 'getPath') return { handled: true, value: makeJavaString(recv && recv.__url ? recv.__url : '') }
      if (ref.name === 'getFile') return { handled: true, value: makeJavaString(recv && recv.__url ? recv.__url : '') }
      if (ref.name === 'getProtocol') return { handled: true, value: makeJavaString('file') }
      if (ref.name === 'openStream') return { handled: true, value: null }
      if (ref.name === 'openConnection') return { handled: true, value: null }
    }
    if ((ref.cls === 'java/lang/ClassLoader' || ref.cls === 'java/lang/Class') && ref.name === 'getResource') {
      return { handled: true, value: { __class: 'java/net/URL', __url: 'file:/' + stringValue(args[0]) } }
    }
    if ((ref.cls === 'java/lang/ClassLoader' || ref.cls === 'java/lang/Class') && ref.name === 'getResources') {
      return { handled: true, value: { __enum: true, items: [] } }
    }
    if (recv && recv.__enum) {
      if (ref.name === 'hasMoreElements') return { handled: true, value: recv.items.length ? 1 : 0 }
      if (ref.name === 'nextElement') return { handled: true, value: recv.items.shift() }
    }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === '<init>') { recv.__sb = ''; return { handled: true } }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === 'append') { const ad = ref.desc; const av = args[0]; recv.__sb = (recv.__sb || '') + (ad === '(C)Ljava/lang/StringBuilder;' ? String.fromCharCode(av | 0) : ad === '(Z)Ljava/lang/StringBuilder;' ? (av ? 'true' : 'false') : stringValue(av)); return { handled: true, value: recv } }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === 'toString') return { handled: true, value: makeJavaString(recv.__sb || '') }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === 'length') return { handled: true, value: (recv.__sb || '').length }
    if (ref.cls === 'com/google/common/base/Preconditions' && ref.name === 'checkNotNull') { if (args[0] == null) console.log('CHECKNULL at ' + currentMethod + ' recent=' + recent.slice(-8).join(' <- ')); return { handled: true, value: args[0] } }
    if (ref.cls === 'java/lang/Throwable' && ref.name === 'getMessage') { const m = recv && recv.fields && recv.fields.detailMessage; return { handled: true, value: m || null } }
    if (ref.cls === 'java/lang/Throwable' && ref.name === 'toString') { const m = recv && recv.fields && recv.fields.detailMessage; return { handled: true, value: m || makeJavaString(recv && recv.__class ? recv.__class : '') } }
    if (ref.cls === 'org/spongepowered/asm/util/JavaVersion' && ref.name === 'current') return { handled: true, value: 17.0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getOption') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getRefmapObfuscationContext') return { handled: true, value: makeJavaString('searge') }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment$Option' && ref.name === 'getStringValue') return { handled: true, value: makeJavaString('') }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment$Option' && ref.name === 'getBooleanValue') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getIntegerValue') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getRefMapper') return { handled: true, value: { __refmap: true } }
    if (recv && recv.__refmap) { if (ref.name === 'setContext') return { handled: true }; if (ref.name === 'remap') return { handled: true, value: args[1] }; if (ref.name === 'remapWithContext') return { handled: true, value: args[1] }; if (ref.name === 'getResourceName') return { handled: true, value: makeJavaString('mixins.test.refmap.json') }; if (ref.name === 'getStatus') return { handled: true, value: makeJavaString('default') }; if (ref.name === 'getContext') return { handled: true, value: makeJavaString('') } }
    if (ref.name === 'setContext' && ref.cls && ref.cls.indexOf('IReferenceMapper') >= 0) return { handled: true }
    if (ref.cls === 'org/spongepowered/asm/mixin/refmap/IReferenceMapper' && ref.name === 'isDefault') return { handled: true, value: recv && recv.__refmap ? 1 : 1 }
    if (ref.cls === 'java/lang/Class' && ref.name === 'cast') return { handled: true, value: args[0] }
    if (ref.cls === 'java/lang/reflect/Field' && ref.name === 'getType') { return { handled: true, value: classFromDesc(recv && recv.__desc ? recv.__desc : 'Ljava/lang/Object;') } }
    if (ref.cls === 'java/lang/reflect/Field' && ref.name === 'getDeclaringClass') return { handled: true, value: classObject(recv && recv.__owner ? recv.__owner : 'java/lang/Object') }
    if (ref.cls === 'java/lang/reflect/Field' && ref.name === 'getModifiers') return { handled: true, value: 1 }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo' && ref.name === 'getTargetClasses') { const set = recv && recv.fields && recv.fields.targetClasses; const items = set && set.__items ? set.__items : []; const names = recv && recv.fields && recv.fields.targetClassNames; const nameItems = names && names.__items ? names.__items : []; console.log('TARGETS size=' + items.length + ' names=' + nameItems.length + ' list=' + JSON.stringify(nameItems.map((x) => (x && x.__class === 'java/lang/String' ? stringValue(x) : String(x))))) }
    if (ref.cls === 'com/google/common/collect/Lists' && ref.name === 'transform' && args[0]) {
      const src = args[0].__items || (args[0].__coll ? args[0].items : null)
      if (src) return { handled: true, value: { __coll: true, items: src.map((v) => (v && v.fields && v.fields.name ? v.fields.name : v)) } }
    }
    if (ref.cls === 'com/google/common/base/Functions' && ref.name === 'toStringFunction') return { handled: true, value: { __fn: true } }
    if (recv && recv.__fn && ref.name === 'apply') return { handled: true, value: makeJavaString(stringValue(args[0])) }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && ref.name === 'getValue' && ref.desc === '(Lorg/objectweb/asm/tree/AnnotationNode;Ljava/lang/String;Z)Ljava/util/List;') {
      const an0 = args[0]; const vs0 = an0 && an0.fields && an0.fields.values; const items0 = vs0 && vs0.__items ? vs0.__items : []; const key0 = stringValue(args[1])
      for (let i = 0; i + 1 < items0.length; i += 2) {
        if (stringValue(items0[i]) === key0) {
          const v0 = items0[i + 1]
          if (v0 && v0.__items) return { handled: true, value: v0 }
          if (Array.isArray(v0)) return { handled: true, value: { __coll: true, items: v0 } }
          return { handled: true, value: { __coll: true, items: [v0] } }
        }
      }
      return { handled: true, value: { __coll: true, items: [] } }
    }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && ref.name === 'getValue') { const an = args[0]; const vs = an && an.fields && an.fields.values; const items = vs && vs.__items ? vs.__items : []; const key = stringValue(args[1]); for (let i = 0; i + 1 < items.length; i += 2) { const k = stringValue(items[i]); if (k === 'cancellable' || k === 'targets') console.log('ANNGET ' + k + ' val=' + (items[i+1] && items[i+1].__class ? items[i+1].__class : String(items[i+1]))); if (k === 'cancellable' && key === 'cancellable') return { handled: true, value: true }; if (k === key) return { handled: true, value: items[i + 1] } } const dflt = args.length >= 4 ? args[3] : (args.length === 3 && !(ref.desc && ref.desc.indexOf('Z)Ljava/util/List;') >= 0) ? args[2] : null); return { handled: true, value: dflt } }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && ref.name === 'get') { const items = args[0] && args[0].__items ? args[0].__items : []; const clsArg = args[1]; const wantName = clsArg && clsArg.__className ? clsArg.__className : stringValue(clsArg).replace(/^L/, '').replace(/;$/, ''); if (/Mixin|Inject/.test(wantName)) console.log('ANNGET want=' + wantName + ' items=' + (args[0] ? (args[0].__items ? args[0].__items.length : 'no-items:' + (args[0].__class || typeof args[0])) : 'null') + ' descs=' + JSON.stringify(items.slice(0, 4).map((a) => (a && a.fields ? stringValue(a.fields.desc) : '?')))); const wantDesc = 'L' + wantName + ';'; let found = null; for (const a of items) { const d = a && a.fields ? stringValue(a.fields.desc) : ''; if (d === wantDesc || d === wantName || d.endsWith(wantDesc) || d === 'L' + wantName.replace(/\./g, '/') + ';') { found = a; break } } return { handled: true, value: found } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo$SubType' && ref.name === 'getTypeFor') { const obj = newObject('org/spongepowered/asm/mixin/transformer/MixinInfo$SubType$Standard'); try { const ctor = resolveMethod({ cls: 'org/spongepowered/asm/mixin/transformer/MixinInfo$SubType$Standard', name: '<init>', desc: '(Lorg/spongepowered/asm/mixin/transformer/MixinInfo;)V' }, obj); invoke(ctor.method, obj, [args[0]]) } catch (e) {} return { handled: true, value: obj } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo' && ref.name === 'getVariant') return { handled: true, value: { __class: 'org/spongepowered/asm/mixin/transformer/MixinInfo', __name: 'STANDARD', __ordinal: 0, __enum: true, fields: { ordinal: 0, name: makeJavaString('STANDARD') } } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/ClassInfo' && ref.name === 'isInterface') return { handled: true, value: recv && recv.fields && recv.fields.isInterface ? 1 : 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/ClassInfo' && ref.name === 'getAccess') return { handled: true, value: recv && recv.fields ? (recv.fields.access | 0) : 0 }
    if (ref.cls === 'org/objectweb/asm/tree/ClassNode' && ref.name === '<init>' && args.length === 1 && args[0] == null) { args[0] = 589824; return { handled: false } }
    if (ref.cls === 'org/objectweb/asm/tree/MethodNode' && ref.name === '<init>' && args.length === 1 && args[0] == null) { args[0] = 589824; return { handled: false } }
    if (ref.cls === 'org/objectweb/asm/MethodVisitor' && ref.name === '<init>' && args[0] == null) { args[0] = 589824; return { handled: false } }
    if (ref.cls === 'org/objectweb/asm/ClassVisitor' && ref.name === '<init>') { console.log('CV API args=' + JSON.stringify(args.map((x) => (x && x.__class ? x.__class : x))) + ' at ' + currentMethod); return { handled: false } }
    if (ref.cls === 'java/lang/IllegalArgumentException' && ref.name === '<init>' && args.length === 1) { console.log('IAE ' + stringValue(args[0]) + ' at ' + currentMethod + ' recent=' + recent.slice(-6).join(' <- ')); return { handled: false } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinConfig' && ref.name === 'prepareMixins') { const pm = recv && recv.fields && recv.fields.pendingMixins; const mx = recv && recv.fields && recv.fields.mixins; if (pm) pm.__tag = 'pending-' + cid(recv); const items = pm && pm.__items ? pm.__items : null; console.log('PREMIX cid=' + cid(recv) + ' ' + stringValue(args[0]) + ' size=' + (args[1] && args[1].__items ? args[1].__items.length : 'n/a') + ' pending=' + (items ? JSON.stringify(items.map((x) => (x ? (x.__class || 'obj') : 'undef'))) : '?') + ' mixins=' + (mx && mx.__items ? mx.__items.length : '?') + ' same=' + (pm && mx && pm.__items === mx.__items)); return { handled: false } }
    if (ref.name === 'set' && args.length === 2 && recv && recv.__class && String(recv.__class).indexOf('ArrayList') >= 0) { if (!recv.__items) recv.__items = []; const old = recv.__items[args[0] | 0]; recv.__items[args[0] | 0] = args[1]; return { handled: true, value: old } }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === '<init>') { recv.__sb = ''; return { handled: true } }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === 'append') { const ad = ref.desc; const av = args[0]; recv.__sb = (recv.__sb || '') + (ad === '(C)Ljava/lang/StringBuilder;' ? String.fromCharCode(av | 0) : ad === '(Z)Ljava/lang/StringBuilder;' ? (av ? 'true' : 'false') : stringValue(av)); return { handled: true, value: recv } }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === 'toString') return { handled: true, value: makeJavaString(recv.__sb || '') }
    if ((ref.cls === 'java/lang/StringBuilder' || ref.cls === 'java/lang/AbstractStringBuilder') && ref.name === 'length') return { handled: true, value: (recv.__sb || '').length }
    if (ref.cls === 'com/google/common/base/Preconditions' && ref.name === 'checkNotNull') { if (args[0] == null) console.log('CHECKNULL at ' + currentMethod + ' recent=' + recent.slice(-8).join(' <- ')); return { handled: true, value: args[0] } }
    if (ref.cls === 'java/lang/Throwable' && ref.name === 'getMessage') { const m = recv && recv.fields && recv.fields.detailMessage; return { handled: true, value: m || null } }
    if (ref.cls === 'java/lang/Throwable' && ref.name === 'toString') { const m = recv && recv.fields && recv.fields.detailMessage; return { handled: true, value: m || makeJavaString(recv && recv.__class ? recv.__class : '') } }
    if (ref.cls === 'org/spongepowered/asm/util/JavaVersion' && ref.name === 'current') return { handled: true, value: 17.0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getOption') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getRefmapObfuscationContext') return { handled: true, value: makeJavaString('searge') }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment$Option' && ref.name === 'getStringValue') return { handled: true, value: makeJavaString('') }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment$Option' && ref.name === 'getBooleanValue') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getIntegerValue') return { handled: true, value: 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/MixinEnvironment' && ref.name === 'getRefMapper') return { handled: true, value: { __refmap: true } }
    if (recv && recv.__refmap) { if (ref.name === 'setContext') return { handled: true }; if (ref.name === 'remap') return { handled: true, value: args[1] }; if (ref.name === 'remapWithContext') return { handled: true, value: args[1] }; if (ref.name === 'getResourceName') return { handled: true, value: makeJavaString('mixins.test.refmap.json') }; if (ref.name === 'getStatus') return { handled: true, value: makeJavaString('default') }; if (ref.name === 'getContext') return { handled: true, value: makeJavaString('') } }
    if (ref.name === 'setContext' && ref.cls && ref.cls.indexOf('IReferenceMapper') >= 0) return { handled: true }
    if (ref.cls === 'org/spongepowered/asm/mixin/refmap/IReferenceMapper' && ref.name === 'isDefault') return { handled: true, value: recv && recv.__refmap ? 1 : 1 }
    if (ref.cls === 'java/lang/Class' && ref.name === 'cast') return { handled: true, value: args[0] }
    if (ref.cls === 'java/lang/reflect/Field' && ref.name === 'getType') { return { handled: true, value: classFromDesc(recv && recv.__desc ? recv.__desc : 'Ljava/lang/Object;') } }
    if (ref.cls === 'java/lang/reflect/Field' && ref.name === 'getDeclaringClass') return { handled: true, value: classObject(recv && recv.__owner ? recv.__owner : 'java/lang/Object') }
    if (ref.cls === 'java/lang/reflect/Field' && ref.name === 'getModifiers') return { handled: true, value: 1 }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo' && ref.name === 'getTargetClasses') { const set = recv && recv.fields && recv.fields.targetClasses; const items = set && set.__items ? set.__items : []; const names = recv && recv.fields && recv.fields.targetClassNames; const nameItems = names && names.__items ? names.__items : []; console.log('TARGETS size=' + items.length + ' names=' + nameItems.length + ' list=' + JSON.stringify(nameItems.map((x) => (x && x.__class === 'java/lang/String' ? stringValue(x) : String(x))))) }
    if (ref.cls === 'com/google/common/collect/Lists' && ref.name === 'transform' && args[0]) {
      const src = args[0].__items || (args[0].__coll ? args[0].items : null)
      if (src) return { handled: true, value: { __coll: true, items: src.map((v) => (v && v.fields && v.fields.name ? v.fields.name : v)) } }
    }
    if (ref.cls === 'com/google/common/base/Functions' && ref.name === 'toStringFunction') return { handled: true, value: { __fn: true } }
    if (recv && recv.__fn && ref.name === 'apply') return { handled: true, value: makeJavaString(stringValue(args[0])) }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && ref.name === 'getValue' && ref.desc === '(Lorg/objectweb/asm/tree/AnnotationNode;Ljava/lang/String;Z)Ljava/util/List;') {
      const an0 = args[0]; const vs0 = an0 && an0.fields && an0.fields.values; const items0 = vs0 && vs0.__items ? vs0.__items : []; const key0 = stringValue(args[1])
      for (let i = 0; i + 1 < items0.length; i += 2) {
        if (stringValue(items0[i]) === key0) {
          const v0 = items0[i + 1]
          if (v0 && v0.__items) return { handled: true, value: v0 }
          if (Array.isArray(v0)) return { handled: true, value: { __coll: true, items: v0 } }
          return { handled: true, value: { __coll: true, items: [v0] } }
        }
      }
      return { handled: true, value: { __coll: true, items: [] } }
    }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && ref.name === 'getValue') { const an = args[0]; const vs = an && an.fields && an.fields.values; const items = vs && vs.__items ? vs.__items : []; const key = stringValue(args[1]); for (let i = 0; i + 1 < items.length; i += 2) { const k = stringValue(items[i]); if (k === 'cancellable' || k === 'targets') console.log('ANNGET ' + k + ' val=' + (items[i+1] && items[i+1].__class ? items[i+1].__class : String(items[i+1]))); if (k === 'cancellable' && key === 'cancellable') return { handled: true, value: true }; if (k === key) return { handled: true, value: items[i + 1] } } const dflt = args.length >= 4 ? args[3] : (args.length === 3 && !(ref.desc && ref.desc.indexOf('Z)Ljava/util/List;') >= 0) ? args[2] : null); return { handled: true, value: dflt } }
    if (ref.cls === 'org/spongepowered/asm/util/Annotations' && ref.name === 'get') { const items = args[0] && args[0].__items ? args[0].__items : []; const clsArg = args[1]; const wantName = clsArg && clsArg.__className ? clsArg.__className : stringValue(clsArg).replace(/^L/, '').replace(/;$/, ''); if (/Mixin|Inject/.test(wantName)) console.log('ANNGET want=' + wantName + ' items=' + (args[0] ? (args[0].__items ? args[0].__items.length : 'no-items:' + (args[0].__class || typeof args[0])) : 'null') + ' descs=' + JSON.stringify(items.slice(0, 4).map((a) => (a && a.fields ? stringValue(a.fields.desc) : '?')))); const wantDesc = 'L' + wantName + ';'; let found = null; for (const a of items) { const d = a && a.fields ? stringValue(a.fields.desc) : ''; if (d === wantDesc || d === wantName || d.endsWith(wantDesc) || d === 'L' + wantName.replace(/\./g, '/') + ';') { found = a; break } } return { handled: true, value: found } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo$SubType' && ref.name === 'getTypeFor') { const obj = newObject('org/spongepowered/asm/mixin/transformer/MixinInfo$SubType$Standard'); try { const ctor = resolveMethod({ cls: 'org/spongepowered/asm/mixin/transformer/MixinInfo$SubType$Standard', name: '<init>', desc: '(Lorg/spongepowered/asm/mixin/transformer/MixinInfo;)V' }, obj); invoke(ctor.method, obj, [args[0]]) } catch (e) {} return { handled: true, value: obj } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinInfo' && ref.name === 'getVariant') return { handled: true, value: { __class: 'org/spongepowered/asm/mixin/transformer/MixinInfo', __name: 'STANDARD', __ordinal: 0, __enum: true, fields: { ordinal: 0, name: makeJavaString('STANDARD') } } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/ClassInfo' && ref.name === 'isInterface') return { handled: true, value: recv && recv.fields && recv.fields.isInterface ? 1 : 0 }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/ClassInfo' && ref.name === 'getAccess') return { handled: true, value: recv && recv.fields ? (recv.fields.access | 0) : 0 }
    if (ref.cls === 'org/objectweb/asm/tree/ClassNode' && ref.name === '<init>' && args.length === 1 && args[0] == null) { args[0] = 589824; return { handled: false } }
    if (ref.cls === 'org/objectweb/asm/tree/MethodNode' && ref.name === '<init>' && args.length === 1 && args[0] == null) { args[0] = 589824; return { handled: false } }
    if (ref.cls === 'org/objectweb/asm/MethodVisitor' && ref.name === '<init>' && args[0] == null) { args[0] = 589824; return { handled: false } }
    if (ref.cls === 'org/objectweb/asm/ClassVisitor' && ref.name === '<init>') { console.log('CV API args=' + JSON.stringify(args.map((x) => (x && x.__class ? x.__class : x))) + ' at ' + currentMethod); return { handled: false } }
    if (ref.cls === 'java/lang/IllegalArgumentException' && ref.name === '<init>' && args.length === 1) { console.log('IAE ' + stringValue(args[0]) + ' at ' + currentMethod + ' recent=' + recent.slice(-6).join(' <- ')); return { handled: false } }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinConfig' && ref.name === 'prepareMixins') { const pm = recv && recv.fields && recv.fields.pendingMixins; const mx = recv && recv.fields && recv.fields.mixins; if (pm) pm.__tag = 'pending-' + cid(recv); const items = pm && pm.__items ? pm.__items : null; console.log('PREMIX cid=' + cid(recv) + ' ' + stringValue(args[0]) + ' size=' + (args[1] && args[1].__items ? args[1].__items.length : 'n/a') + ' pending=' + (items ? JSON.stringify(items.map((x) => (x ? (x.__class || 'obj') : 'undef'))) : '?') + ' mixins=' + (mx && mx.__items ? mx.__items.length : '?') + ' same=' + (pm && mx && pm.__items === mx.__items)); return { handled: false } }
    if (ref.name === 'set' && args.length === 2 && recv && recv.__class && String(recv.__class).indexOf('ArrayList') >= 0) { if (!recv.__items) recv.__items = []; const old = recv.__items[args[0] | 0]; recv.__items[args[0] | 0] = args[1]; return { handled: true, value: old } }
    if (recv && recv.__items) {
      const syncArr = () => { if (recv.fields) { recv.fields.elementData = recv.__items; recv.fields.size = recv.__items.length } }
      if (ref.name === 'addAll' && args[0]) {
        const src = listToArray(args[0])
        if (src) { for (const v of src) recv.__items.push(v); syncArr(); return { handled: true, value: src.length ? 1 : 0 } }
      }
      if (ref.name === 'clear') { recv.__items.length = 0; syncArr(); return { handled: true } }
      if (ref.name === 'remove' && args.length === 1) {
        const idx = typeof args[0] === 'number' ? (args[0] | 0) : recv.__items.indexOf(args[0])
        if (idx < 0 || idx >= recv.__items.length) return { handled: true, value: null }
        const old = recv.__items.splice(idx, 1)[0]
        syncArr()
        return { handled: true, value: typeof args[0] === 'number' ? old : 1 }
      }
      if (ref.name === 'size') return { handled: true, value: recv.__items.length }
      if (ref.name === 'isEmpty') return { handled: true, value: recv.__items.length ? 0 : 1 }
      if (ref.name === 'get' && typeof args[0] === 'number') return { handled: true, value: recv.__items[args[0] | 0] }
      if (ref.name === 'add' && (ref.desc === '(Ljava/lang/Object;)Z' || args.length > 1)) { if (args.length > 1) recv.__items.splice(args[0] | 0, 0, args[1]); else recv.__items.push(args[0]); syncArr(); return { handled: true, value: 1 } }
      if (ref.name === 'iterator') return { handled: true, value: { __chmIter: true, items: recv.__items, i: 0 } }
      if (ref.name === 'contains') return { handled: true, value: recv.__items.includes(args[0]) ? 1 : 0 }
      if (ref.name === 'toArray') { const a = recv.__items.slice(); a.__array = true; return { handled: true, value: a } }
    }
    if (ref.name === 'addAll' && args[0] && recv && !recv.__items && !recv.__coll) {
      const src0 = listToArray(args[0])
      if (src0) {
        try {
          const addm = resolveMethod({ cls: recv.__class, name: 'add', desc: '(Ljava/lang/Object;)Z' }, recv)
          let ch = 0
          for (const v of src0) ch |= invoke(addm.method, recv, [v])
          return { handled: true, value: ch ? 1 : 0 }
        } catch (e) { if (e && e.missingClass) throw e; console.log('ADDALL-FALLBACK ERR ' + e.message) }
      }
    }
    if (ref.cls === 'java/util/ArrayList') {
      if (ref.name === '<init>') { recv.__items = []; if (recv.fields) { recv.fields.elementData = recv.__items; recv.fields.size = 0 } return { handled: true } }
      if (ref.name === 'addAll' && args[0]) {
        if (!recv.__items) recv.__items = []
        const src = listToArray(args[0])
        if (src) { for (const v of src) recv.__items.push(v); if (recv.fields) recv.fields.size = recv.__items.length; return { handled: true, value: src.length ? 1 : 0 } }
      }
      if (ref.name === 'add') { console.log('AL ADD ' + (args[0] && args[0].__class ? args[0].__class : String(args[0]))); recv.__items.push(args[0]); if (recv.fields) { recv.fields.elementData = recv.__items; recv.fields.size = recv.__items.length }; return { handled: true, value: 1 } }
      if (ref.name === 'get' && typeof args[0] === 'number') { if (!recv.__items) recv.__items = []; return { handled: true, value: recv.__items[args[0] | 0] } }
      if (ref.name === 'set') { if (!recv.__items) recv.__items = []; const old = recv.__items[args[0] | 0]; recv.__items[args[0] | 0] = args[1]; if (recv.fields) recv.fields.elementData = recv.__items; return { handled: true, value: old } }
      if (ref.name === 'remove') { if (!recv.__items) recv.__items = []; const old = recv.__items.splice(args[0] | 0, 1)[0]; if (recv.fields) { recv.fields.elementData = recv.__items; recv.fields.size = recv.__items.length }; return { handled: true, value: old } }
      if (ref.name === 'clear') { recv.__items = []; if (recv.fields) { recv.fields.elementData = recv.__items; recv.fields.size = 0 }; return { handled: true } }
      if (ref.name === 'size') return { handled: true, value: recv.__items ? recv.__items.length : 0 }
      if (ref.name === 'isEmpty') return { handled: true, value: recv.__items.length ? 0 : 1 }
      if (ref.name === 'contains') return { handled: true, value: recv.__items.includes(args[0]) ? 1 : 0 }
      if (ref.name === 'iterator') return { handled: true, value: { __chmIter: true, items: recv.__items, i: 0 } }
      if (ref.name === 'toArray') { const a = recv.__items.slice(); a.__array = true; return { handled: true, value: a } }
    }
    if (ref.cls === 'org/spongepowered/asm/mixin/transformer/MixinProcessor' && ref.name === 'handleMixinError') {
      const decode = (o) => {
        if (!o) return ''
        if (typeof o === 'string') return o
        const f = o.fields || {}
        const m = f.detailMessage
        if (m && m.fields && m.fields.value) {
          const b = m.fields.value
          return Buffer.from(b).toString(m.fields.coder === 1 ? 'utf16le' : 'latin1')
        }
        return ''
      }
      console.log('MIXERRMSG ' + decode(args[1]) + ' / ' + decode(args[1] && args[1].fields && args[1].fields.cause))
      throw new Error('mixin processing error')
    }
    if (ref.cls === 'com/google/gson/Gson' && ref.name === 'fromJson') {
      const target = args[1] && args[1].__className
      if (target === 'org/spongepowered/asm/mixin/transformer/MixinConfig') {
        const cfg = newObject(target); try { const ctor = resolveMethod({ cls: target, name: '<init>', desc: '()V' }, cfg); invoke(ctor.method, cfg, []) } catch (e) {} const mkList = (items) => { const list = newObject('java/util/ArrayList'); list.fields.elementData = items.slice(); list.fields.size = items.length; list.fields.modCount = items.length; return list }; Object.assign(cfg.fields, { mixinPackage: makeJavaString('testmix.'), mixinClasses: mkList([makeJavaString('RealMixin')]), mixinClassesClient: mkList([]), mixinClassesServer: mkList([]), requiredValue: 1, required: 1, priority: 1000, mixinPriority: 1000, setSourceFile: 1, initialised: 0, prepared: 0, visited: 0, verboseLogging: 0, compatibility: 'JAVA_17', version: '8', injectorOptions: null, overwriteOptions: null, pluginClassName: null, plugin: { __class: 'org/spongepowered/asm/mixin/transformer/PluginHandle', fields: { parent: cfg, plugin: null, mode: null, mdPreApply: null, mdPostApply: null } }, refMapperConfig: makeJavaString('mixins.test.refmap.json'), refMapper: { __refmap: true }, parentName: null, selector: null }); try { const set = resolveMethod({ cls: 'ConfigHolder', name: 'set', desc: '(Ljava/lang/Object;)V' }, null); invoke(set.method, null, [cfg]) } catch (e) {} return { handled: true, value: cfg }
      }
    }
    if (ref.cls === 'java/lang/String') {
      const txt = stringValue(recv)
      if (ref.name === 'toLowerCase') return { handled: true, value: makeJavaString(txt.toLowerCase()) }
      if (ref.name === 'toUpperCase') return { handled: true, value: makeJavaString(txt.toUpperCase()) }
      if (ref.name === 'length') return { handled: true, value: txt.length }
      if (ref.name === 'isEmpty') return { handled: true, value: txt.length === 0 ? 1 : 0 }
      if (ref.name === 'hashCode') { let h = 0; for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0; return { handled: true, value: h } }
      if (ref.name === 'equals') return { handled: true, value: txt === stringValue(args[0]) ? 1 : 0 }
      if (ref.name === 'equalsIgnoreCase') return { handled: true, value: txt.toLowerCase() === stringValue(args[0]).toLowerCase() ? 1 : 0 }
      if (ref.name === 'charAt') return { handled: true, value: txt.charCodeAt(args[0] | 0) }
      if (ref.name === 'substring') return { handled: true, value: makeJavaString(args.length > 1 ? txt.substring(args[0] | 0, args[1] | 0) : txt.substring(args[0] | 0)) }
      if (ref.name === 'indexOf') {
        const from = args.length > 1 ? (args[1] | 0) : 0
        const needle = typeof args[0] === 'number' ? String.fromCharCode(args[0]) : stringValue(args[0])
        return { handled: true, value: txt.indexOf(needle, from) }
      }
      if (ref.name === 'startsWith') return { handled: true, value: txt.startsWith(stringValue(args[0])) ? 1 : 0 }
      if (ref.name === 'endsWith') return { handled: true, value: txt.endsWith(stringValue(args[0])) ? 1 : 0 }
      if (ref.name === 'contains') return { handled: true, value: txt.includes(stringValue(args[0])) ? 1 : 0 }
      if (ref.name === 'trim') return { handled: true, value: makeJavaString(txt.trim()) }
      if (ref.name === 'split') { let parts; try { parts = txt.split(new RegExp(stringValue(args[0]))) } catch (e) { parts = txt.split(stringValue(args[0])) } const arr = parts.map((x) => makeJavaString(x)); arr.__array = true; return { handled: true, value: arr } }
      if (ref.name === 'replace') { const from = typeof args[0] === 'number' ? String.fromCharCode(args[0]) : stringValue(args[0]); const to = typeof args[1] === 'number' ? String.fromCharCode(args[1]) : stringValue(args[1]); return { handled: true, value: makeJavaString(txt.split(from).join(to)) } }
      if (ref.name === 'getBytes') { const b = []; for (let i = 0; i < txt.length; i++) b.push(txt.charCodeAt(i) & 0xff); return { handled: true, value: b } }
      if (ref.name === 'coder') return { handled: true, value: recv && recv.fields && recv.fields.coder ? 1 : 0 }
      if (ref.name === 'isLatin1') return { handled: true, value: 1 }
      if (ref.name === 'value') return { handled: true, value: recv && recv.fields ? recv.fields.value : [] }
      if (ref.name === 'toString') return { handled: true, value: makeJavaString(txt) }
    }
    if (ref.cls === 'java/lang/Class' && (ref.name === 'registerNatives' || ref.name === 'desiredAssertionStatus0' || ref.name === 'desiredAssertionStatus')) return { handled: true, value: 0 }
    if (ref.cls === 'java/lang/Class' && (ref.name === 'getClassLoader' || ref.name === 'getClassLoader0')) return { handled: true, value: { __class: 'java/lang/ClassLoader' } }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getProtectionDomain0') return { handled: true, value: null }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getProtectionDomain') return { handled: true, value: { __class: 'java/security/ProtectionDomain' } }
    if (ref.cls === 'java/security/ProtectionDomain' && ref.name === 'getCodeSource') return { handled: true, value: { __class: 'java/security/CodeSource' } }
    if (ref.cls === 'java/security/CodeSource' && (ref.name === 'getLocation' || ref.name === 'getCertificates' || ref.name === 'getCodeSigners')) return { handled: true, value: null }
    if (ref.cls === 'java/lang/Enum' && ref.name === 'valueOf') {
      const cls = args[0] && (args[0].__className || args[0].__name || null)
      const nm = stringValue(args[1])
      const sv = cls ? staticField(cls, nm) : null
      console.log('ENUMVALUE cls=' + cls + ' name=' + nm + ' found=' + (sv ? (sv.__class || 'obj') : 'null') + ' fields=' + (sv && sv.fields ? Object.keys(sv.fields).join('|') : '-'))
      if (sv) return { handled: true, value: sv }
      return { handled: true, value: { __class: cls, __name: nm, __enum: true, fields: { name: makeJavaString(nm), ordinal: 0 } } }
    }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getEnumConstants') return { handled: true, value: [] }
    if (ref.cls === 'java/lang/Enum' && (ref.name === 'name' || ref.name === 'toString')) return { handled: true, value: recv && recv.fields && recv.fields.name ? recv.fields.name : makeJavaString(recv && recv.__name ? recv.__name : '') }
    if (ref.cls === 'java/lang/Enum' && ref.name === 'ordinal') return { handled: true, value: recv && recv.fields && typeof recv.fields.ordinal === 'number' ? recv.fields.ordinal : (recv && recv.__ordinal ? recv.__ordinal : 0) }
    if (ref.name === 'ordinal') return { handled: true, value: recv && recv.__ordinal ? recv.__ordinal : 0 }
    if (ref.name === 'name') return { handled: true, value: makeJavaString(recv && recv.__name ? recv.__name : '') }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getSigners') return { handled: true, value: null }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getPackageName') { const n = recv && recv.__className || ''; const i = n.lastIndexOf('/'); return { handled: true, value: makeJavaString(i < 0 ? '' : n.slice(0, i).replace(/\\//g, '.')) } }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getPackage') return { handled: true, value: { __class: 'java/lang/Package', __pkg: true } }
    if (ref.cls === 'java/lang/Package') {
      if (ref.name === 'getImplementationVersion') return { handled: true, value: makeJavaString('9.8') }
      if (ref.name === 'getSpecificationVersion') return { handled: true, value: makeJavaString('9') }
      if (ref.name === 'getName') return { handled: true, value: makeJavaString('') }
      if (ref.name === 'getImplementationTitle' || ref.name === 'getSpecificationTitle' || ref.name === 'getImplementationVendor') return { handled: true, value: null }
    }
    if (ref.cls === 'jdk/internal/reflect/Reflection' && ref.name === 'getCallerClass') {
      return { handled: true, value: classObject('java/util/ServiceLoader') }
    }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'isAtLeastVersion') return { handled: true, value: 1 }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'getVersionString') return { handled: true, value: makeJavaString('ASM 9.7') }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'getApiVersionString') return { handled: true, value: makeJavaString('9.7') }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'getApiVersionMajor') return { handled: true, value: 9 }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'getApiVersionMinor') return { handled: true, value: 7 }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'getMaxSupportedClassVersion') return { handled: true, value: 65 }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && ref.name === 'getClassVersionString') return { handled: true, value: makeJavaString('Java 17 (61)') }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && (ref.name === 'getMaxSupportedClassVersionMajor' || ref.name === 'getVersionMajor')) return { handled: true, value: 61 }
    if (ref.cls === 'org/spongepowered/asm/util/asm/ASM' && (ref.name === 'getMaxSupportedClassVersionMinor' || ref.name === 'getVersionMinor')) return { handled: true, value: 0 }
    if (ref.cls === 'java/lang/String' && ref.name === 'format') {
      const fmt = stringValue(args[0])
      let vals = args.slice(1)
      if (vals.length === 1 && Array.isArray(vals[0])) vals = vals[0].slice()
      let idx = 0
      const out = fmt.replace(/%[-0-9.]*[sSdfxXoc]/g, (m) => { const v = vals[idx++]; if (m.endsWith('d') || m.endsWith('x') || m.endsWith('X')) return String(Number(v)); return v == null ? 'null' : stringValue(v) })
      return { handled: true, value: makeJavaString(out) }
    }
    if (ref.cls === 'java/util/Locale' && ref.name === 'getDefault') return { handled: true, value: { __class: 'java/util/Locale', __name: 'en' } }
    if (ref.cls === 'java/util/Locale' && ref.name === 'toString') return { handled: true, value: makeJavaString(recv && recv.__name ? recv.__name : 'en') }
    if (recv && recv.__coll && ref.name === 'toArray') { const arr = recv.items.slice(); arr.__array = true; return { handled: true, value: arr } }
    if (ref.cls === 'java/util/Collection' && ref.name === 'toArray') return { handled: true, value: [] }
    if (ref.cls === 'java/util/Set' && ref.name === 'of') return { handled: true, value: { __coll: true, items: Array.from(args) } }
    if (ref.cls === 'java/util/List' && ref.name === 'of') return { handled: true, value: { __coll: true, items: Array.from(args) } }
    if (ref.cls === 'java/util/Map' && ref.name === 'of') { const m = new Map(); for (let i = 0; i + 1 < args.length; i += 2) m.set(args[i], args[i + 1]); return { handled: true, value: { __chm: true, __map: m } } }
    if (ref.cls === 'java/io/InputStream') {
      if (ref.name === 'readAllBytes') {
        if (!recv) { const e = []; e.__array = true; return { handled: true, value: e } }
        const arr = Array.from(recv.__bytes || []).map((b) => (b > 127 ? b - 256 : b))
        console.log('READALL ' + arr.length)
        arr.__array = true
        return { handled: true, value: arr }
      }
      if (ref.name === 'read') {
        if (recv && recv.__bytes) {
          if (recv.__pos >= recv.__bytes.length) return { handled: true, value: -1 }
          return { handled: true, value: recv.__bytes[recv.__pos++] }
        }
      }
      if (ref.name === 'close') return { handled: true }
    }
    if (ref.cls === 'java/lang/ClassLoader') {
      if (ref.name === 'getSystemClassLoader') return { handled: true, value: { __class: 'java/lang/ClassLoader' } }
      if (ref.name === 'getResourceAsStream') {
        const path = stringValue(args[0]).replace(/^\//, '')
        const bytes = resourceMap[path]
        if (!bytes) return { handled: true, value: null }
        return { handled: true, value: { __class: 'java/io/InputStream', __bytes: Array.from(bytes), __pos: 0 } }
      }
    }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getResourceAsStream') {
      const path = stringValue(args[0]).replace(/^\//, '')
      const bytes = resourceMap[path]
      if (!bytes) return { handled: true, value: null }
      return { handled: true, value: { __class: 'java/io/InputStream', __bytes: Array.from(bytes), __pos: 0 } }
    }
    if (ref.cls === 'java/lang/Class' && ref.name === 'getResource') {
      const path = '/' + stringValue(args[0]).replace(/^\//, '')
      return { handled: true, value: { __class: 'java/net/URL', __path: path } }
    }
    if (ref.cls === 'java/lang/Object' && ref.name === 'getClass') {
      if (!recv) return { handled: true, value: null }
      return { handled: true, value: classObject(recv.__class) }
    }
    if (ref.cls === 'java/lang/Class') {
      if (ref.name === 'forName') {
        const name = stringValue(args[0]).replace(/\./g, '/')
        if (!classes.has(name)) {
          if (strictMissing(name)) throw new MissingClassError(name)
          const cnfe = classes.has('java/lang/ClassNotFoundException') ? 'java/lang/ClassNotFoundException' : (classes.has('java/lang/Exception') ? 'java/lang/Exception' : null)
          if (!cnfe) throw new MissingClassError(name)
          const ex = newObject(cnfe)
          ex.fields.detailMessage = makeJavaString(name)
          throw { __jvm: true, value: ex, where: currentMethod }
        }
        return { handled: true, value: classObject(name) }
      }
      if (ref.name === 'getName') return { handled: true, value: makeJavaString(recv && recv.__className ? recv.__className.replace(/\//g, '.') : String(recv)) }
      if (ref.name === 'isArray') return { handled: true, value: recv && recv.__className && recv.__className.startsWith('[') ? 1 : 0 }
      if (ref.name === 'isPrimitive') return { handled: true, value: ['int','long','boolean','byte','char','short','float','double','void'].includes(recv && recv.__className) ? 1 : 0 }
      if (ref.name === 'getComponentType') {
        const cn = recv && recv.__className
        if (!cn || !cn.startsWith('[')) return { handled: true, value: null }
        let d = cn.slice(1)
        let out
        if (d[0] === '[') out = classObject(d)
        else if (d[0] === 'L') out = classObject(d.slice(1, -1))
        else out = classObject({ I: 'int', J: 'long', Z: 'boolean', B: 'byte', C: 'char', S: 'short', F: 'float', D: 'double' }[d] || d)
        return { handled: true, value: out }
      }
      if (ref.name === 'getClassLoader') return { handled: true, value: { __class: 'java/lang/ClassLoader' } }
      if (ref.name === 'getModule') return { handled: true, value: pseudoModule }
      if (ref.name === 'getDeclaredClasses' || ref.name === 'getClasses') {
        const cls = classes.get(recv.__className)
        if (!cls) throw new MissingClassError(recv.__className)
        const list = (cls.innerClasses || [])
          .filter((e) => e.outer === recv.__className && e.inner)
          .map((e) => classObject(e.inner))
        return { handled: true, value: list }
      }
      if (ref.name === 'getEnclosingClass') {
        for (const cls of classes.values()) {
          const entry = (cls.innerClasses || []).find((e) => e.inner === recv.__className && e.outer)
          if (entry) return { handled: true, value: classObject(entry.outer) }
        }
        return { handled: true, value: null }
      }
      if (ref.name === 'getSimpleName') {
        let base = recv.__className.split('/').pop()
        if (base.includes('$')) base = base.split('$').pop()
        return { handled: true, value: makeJavaString(base) }
      }
      if (ref.name === 'isInstance') {
        const obj = args[0]
        return { handled: true, value: obj && obj.__class ? (isAssignable(obj.__class, recv.__className) ? 1 : 0) : 0 }
      }
      if (ref.name === 'isAssignableFrom') {
        const other = args[0]
        return { handled: true, value: isAssignable(other.__className, recv.__className) ? 1 : 0 }
      }
      if (ref.name === 'getSuperclass') {
        const cls = classes.get(recv.__className)
        if (!cls) throw new MissingClassError(recv.__className)
        return { handled: true, value: cls.superName ? classObject(cls.superName) : null }
      }
      if (ref.name === 'getGenericSuperclass') {
        const cls = classes.get(recv.__className)
        if (!cls) throw new MissingClassError(recv.__className)
        const name = cls.signature ? genericTypeName(cls.signature) : cls.superName ? cls.superName.replace(/\//g, '.') : null
        return { handled: true, value: name ? { __class: 'java/lang/reflect/Type', __typeName: name } : null }
      }
      if (ref.name === 'getGenericInterfaces') {
        return { handled: true, value: [] }
      }
      if (ref.name === 'getMethod' || ref.name === 'getDeclaredMethod') {
        const methodName = stringValue(args[0])
        const params = args[1] || []
        const paramDesc = params.map(descriptorOf).join('')
        const found = findMethodByName(recv.__className, methodName, paramDesc)
        if (!found) throw new Error('no reflected method ' + recv.__className + '.' + methodName)
        return {
          handled: true,
          value: { __class: 'java/lang/reflect/Method', __owner: found.owner.thisName, __name: found.method.name, __desc: found.method.desc, __annotations: found.method.annotations || [] },
        }
      }
      if (ref.name === 'getAnnotation') {
        const target = args[0] && args[0].__className
        const cls = classes.get(recv.__className)
        if (!cls) throw new MissingClassError(recv.__className)
        const found = findAnnotation(cls.annotations, target)
        return { handled: true, value: found ? annotationObject(found) : null }
      }
      if (ref.name === 'isAnnotationPresent') {
        const target = args[0] && args[0].__className
        const cls = classes.get(recv.__className)
        if (!cls) throw new MissingClassError(recv.__className)
        return { handled: true, value: findAnnotation(cls.annotations, target) ? 1 : 0 }
      }
      if (ref.name === 'getMethods' || ref.name === 'getDeclaredMethods') {
        const walkSuper = ref.name === 'getMethods'
        const result = []
        const seen = new Set()
        const walk = (clsName) => {
          if (!clsName || seen.has(clsName)) return
          seen.add(clsName)
          const cls = classes.get(clsName)
          if (!cls) throw new MissingClassError(clsName)
          for (const method of cls.methods) {
            if (method.name === '<init>' || method.name === '<clinit>') continue
            if (walkSuper && !(method.access & 0x0001)) continue
            result.push({
              __class: 'java/lang/reflect/Method',
              __owner: cls.thisName,
              __name: method.name,
              __desc: method.desc,
              __annotations: method.annotations || [],
            })
          }
          if (walkSuper) walk(cls.superName)
        }
        walk(recv.__className)
        return { handled: true, value: result }
      }
      if (ref.name === 'getFields' || ref.name === 'getDeclaredFields') {
        const walkSuper = ref.name === 'getFields'
        const result = []
        const seen = new Set()
        const walk = (clsName) => {
          if (!clsName || seen.has(clsName)) return
          seen.add(clsName)
          const cls = classes.get(clsName)
          if (!cls) throw new MissingClassError(clsName)
          for (const field of cls.fields || []) {
            if (walkSuper && !(field.access & 0x0001)) continue
            result.push({
              __class: 'java/lang/reflect/Field',
              __owner: cls.thisName,
              __name: field.name,
              __static: (field.access & 0x0008) !== 0,
              __desc: field.desc,
              __annotations: field.annotations || [],
            })
          }
          if (walkSuper) walk(cls.superName)
        }
        walk(recv.__className)
        return { handled: true, value: result }
      }
      if (ref.name === 'getDeclaredField' || ref.name === 'getField') {
        const fieldName = stringValue(args[0])
        const found = findField(recv.__className, fieldName, ref.name === 'getField')
        if (!found) throw new Error('no field ' + recv.__className + '.' + fieldName)
        return {
          handled: true,
          value: {
            __class: 'java/lang/reflect/Field',
            __owner: found.cls.thisName,
            __name: fieldName,
            __static: (found.field.access & 0x0008) !== 0,
            __desc: found.field.desc,
            __annotations: found.field.annotations || [],
          },
        }
      }
      if (ref.name === 'getDeclaredConstructor') {
        const params = args[0] || []
        const paramDesc = params.map(descriptorOf).join('')
        return {
          handled: true,
          value: { __class: 'java/lang/reflect/Constructor', __owner: recv.__className, __name: '<init>', __desc: '(' + paramDesc + ')V' },
        }
      }
      if (ref.name === 'newInstance') {
        if (String(recv.__className).indexOf('MixinConfig') >= 0) console.log('CLASS NEW ' + recv.__className)
        const obj = newObject(recv.__className)
        if (String(recv.__className).indexOf('MixinConfig') >= 0) { obj.fields.name = makeJavaString('mixins.test.json'); obj.fields.initialised = 0; obj.fields.prepared = 0; obj.fields.visited = 0 }
        const found = findMethodByName(recv.__className, '<init>', '')
        if (!found) throw new Error('no default constructor ' + recv.__className)
        invoke(found.method, obj, [])
        return { handled: true, value: obj }
      }
    }
    if (ref.cls === 'java/lang/reflect/Field') {
      if (ref.name === 'getName') return { handled: true, value: makeJavaString(recv.__name) }
      if (ref.name === 'setAccessible' || ref.name === 'trySetAccessible') return { handled: true, value: 1 }
      if (ref.name === 'getAnnotation') {
        const found = findAnnotation(recv.__annotations, args[0] && args[0].__className)
        return { handled: true, value: found ? annotationObject(found) : null }
      }
      if (ref.name === 'get' || ref.name.startsWith('get') && ref.desc.startsWith('(Ljava/lang/Object;)')) {
        const obj = args[0]
        if (recv.__static) return { handled: true, value: staticField(recv.__owner, recv.__name) }
        return { handled: true, value: obj ? obj.fields[recv.__name] : null }
      }
      if (ref.name === 'set' || ref.name.startsWith('set') && ref.desc.startsWith('(Ljava/lang/Object;')) {
        const obj = args[0]
        const value = args[1]
        if (recv.__static) setStaticField(recv.__owner, recv.__name, value)
        else obj.fields[recv.__name] = value
        return { handled: true }
      }
    }
    if (ref.cls === 'java/lang/Math') {
      if (ref.name === 'sin') return { handled: true, value: Math.sin(args[0]) }
      if (ref.name === 'cos') return { handled: true, value: Math.cos(args[0]) }
      if (ref.name === 'tan') return { handled: true, value: Math.tan(args[0]) }
      if (ref.name === 'sqrt') return { handled: true, value: Math.sqrt(args[0]) }
      if (ref.name === 'abs') return { handled: true, value: Math.abs(args[0]) }
      if (ref.name === 'floor') return { handled: true, value: Math.floor(args[0]) }
      if (ref.name === 'ceil') return { handled: true, value: Math.ceil(args[0]) }
      if (ref.name === 'toRadians') return { handled: true, value: (args[0] * Math.PI) / 180 }
      if (ref.name === 'toDegrees') return { handled: true, value: (args[0] * 180) / Math.PI }
      if (ref.name === 'max') return { handled: true, value: Math.max(args[0], args[1]) }
      if (ref.name === 'min') return { handled: true, value: Math.min(args[0], args[1]) }
    }
    if (ref.cls === 'java/lang/System') {
      if (ref.name === 'currentTimeMillis') return { handled: true, value: Date.now() }
      if (ref.name === 'nanoTime') return { handled: true, value: Math.round(performance.now() * 1e6) }
      if (ref.name === 'getProperty') {
        const key = stringValue(args[0])
        const props = {
          'java.version': '17.0.19',
          'java.vendor': 'Self-made VM',
          'os.name': 'Browser',
          'file.encoding': 'UTF-8',
          'line.separator': '\n',
          'user.dir': '/',
        }
        if (key in props) return { handled: true, value: makeJavaString(props[key]) }
        return { handled: true, value: args.length > 1 ? args[1] : null }
      }
      if (ref.name === 'getenv') return { handled: true, value: null }
    }
    if (ref.cls === 'java/lang/reflect/Method') {
      if (ref.name === 'getName') return { handled: true, value: makeJavaString(recv.__name) }
      if (ref.name === 'getDeclaringClass') return { handled: true, value: classObject(recv.__owner) }
      if (ref.name === 'getParameterCount') return { handled: true, value: argCount(recv.__desc) }
      if (ref.name === 'getReturnType') {
        const ret = recv.__desc.slice(recv.__desc.indexOf(')') + 1)
        return { handled: true, value: classFromDesc(ret) }
      }
      if (ref.name === 'getParameterTypes') {
        return { handled: true, value: paramsFromDesc(recv.__desc) }
      }
      if (ref.name === 'getAnnotation') {
        const found = findAnnotation(recv.__annotations, args[0] && args[0].__className)
        return { handled: true, value: found ? annotationObject(found) : null }
      }
      if (ref.name === 'invoke') {
        if (recv.__owner === 'java/lang/ClassLoader' && recv.__name === 'defineClass') {
          const name = stringValue(args[1] && args[1][0])
          const byteArray = Array.from(args[1] && args[1][1] ? args[1][1] : [])
          const offArg = args[1] && args[1][2]
          const lenArg = args[1] && args[1][3]
          const off = offArg && offArg.__int !== undefined ? offArg.__int : offArg | 0
          const len = lenArg && lenArg.__int !== undefined ? lenArg.__int : lenArg | 0
          const bytes = new Uint8Array(byteArray.slice(off, off + len))
          const parsed = parseClass(bytes.buffer)
          classes.set(name || parsed.thisName, parsed)
          return { handled: true, value: classObject(parsed.thisName) }
        }
        const receiver = args[0]
        const params = args[1] ? Array.from(args[1]) : []
        const resolved = resolveMethod({ cls: recv.__owner, name: recv.__name, desc: recv.__desc }, receiver)
        const value = invoke(resolved.method, receiver, params)
        return { handled: true, value }
      }
      if (ref.name === 'setAccessible' || ref.name === 'trySetAccessible') return { handled: true, value: 1 }
    }
    if (ref.cls === 'java/lang/reflect/Method' && ref.name === 'invoke') {
      const receiver = args[0]
      const params = args[1] ? Array.from(args[1]) : []
      const resolved = resolveMethod({ cls: recv.__owner, name: recv.__name, desc: recv.__desc }, receiver)
      const value = invoke(resolved.method, receiver, params)
      return { handled: true, value }
    }
    if (ref.cls === 'java/lang/reflect/Constructor' && ref.name === 'newInstance') {
      const obj = newObject(recv.__owner)
      const resolved = resolveMethod({ cls: recv.__owner, name: recv.__name, desc: recv.__desc }, obj, true)
      const params = args[0] ? Array.from(args[0]) : []
      invoke(resolved.method, obj, params)
      return { handled: true, value: obj }
    }
    const key = ref.cls + '.' + ref.name + ref.desc
    if (ref.name === 'length' && ref.desc === '()I' && recv && recv.__class === 'java/lang/StringBuilder') {
      return { handled: true, value: recv.fields.count | 0 }
    }
    if (ref.cls === 'java/lang/AbstractStringBuilder' && ref.name === '<init>' && ref.desc === '(I)V') {
      const cap = Math.max(0, args[0] | 0)
      recv.fields.value = new Array(cap).fill(0)
      recv.fields.coder = 0
      recv.fields.count = 0
      return { handled: true }
    }
    if (ref.cls === 'java/lang/StringBuilder' && recv && recv.__sb !== undefined) {
      if (ref.name === '<init>') {
        recv.__sb = ''
        return { handled: true }
      }
      if (ref.name === 'append' && ref.desc === '(Ljava/lang/String;)Ljava/lang/StringBuilder;') {
        recv.__sb += stringValue(args[0])
        return { handled: true, value: recv }
      }
      if (ref.name === 'append' && ref.desc === '(I)Ljava/lang/StringBuilder;') {
        recv.__sb += String(args[0])
        return { handled: true, value: recv }
      }
      if (ref.name === 'toString') return { handled: true, value: recv.__sb }
    }
    if (ref.cls === 'java/lang/String' && typeof recv === 'string') {
      if (ref.name === 'length') return { handled: true, value: recv.length }
      if (ref.name === 'charAt') return { handled: true, value: recv.charCodeAt(args[0]) }
    }
    if (ref.cls === 'java/lang/System' && ref.name === 'arraycopy') {
      const [src, srcPos, dst, dstPos, len] = args
      if (!src || !dst) return { handled: true }
      for (let i = 0; i < len; i++) dst[dstPos + i] = src[srcPos + i]
      return { handled: true }
    }
    if (ref.cls === 'java/lang/Throwable' && ref.name === 'fillInStackTrace') {
      return { handled: true, value: recv }
    }
    if (ref.cls === 'java/lang/Object' && ref.name === '<init>') return { handled: true }
    return { handled: false }
  }

  function constValue(cls, idx) {
    const c = cls.cp[idx]
    if (!c) return null
    if (c.tag === 8) return cls.cp[c.index].value
    return c.value
  }

  function constant(cls, idx) {
    const c = cls.cp[idx]
    if (c.tag === 8) return makeJavaString(cls.cp[c.index].value)
    if (c.tag === 7) return classObject(cls.cp[c.index].value)
    return c.value
  }

  return {
    classes,
    out,
    runMain(name) {
      const cls = classes.get(name)
      if (!cls) throw new Error('no class ' + name)
      const main = getMethods(cls).get('main([Ljava/lang/String;)V')
      if (!main) throw new Error('no main in ' + name)
      invoke(main, null, [null])
      return out
    },
  }
}
