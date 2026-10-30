/* Minimal Java 17 class-file parser + bytecode interpreter, written from scratch.
   Supports the subset needed for Demo.class: constants, int arithmetic, branches,
   static/virtual calls, System.out.println. No JDK, no JNI, no GC. */

const OP = {
  ALOAD_0: 0x2a,
  ILOAD: 0x15,
  ILOAD_0: 0x1a,
  ILOAD_1: 0x1b,
  ILOAD_2: 0x1c,
  ILOAD_3: 0x1d,
  ISTORE: 0x36,
  ISTORE_0: 0x3b,
  ISTORE_1: 0x3c,
  ISTORE_2: 0x3d,
  ISTORE_3: 0x3e,
  BIPUSH: 0x10,
  SIPUSH: 0x11,
  LDC: 0x12,
  LDC_W: 0x13,
  IADD: 0x60,
  ISUB: 0x64,
  IMUL: 0x68,
  IDIV: 0x6c,
  IREM: 0x70,
  INEG: 0x74,
  IINC: 0x84,
  IFEQ: 0x99,
  IFNE: 0x9a,
  IFLT: 0x9b,
  IFGE: 0x9c,
  IFGT: 0x9d,
  IFLE: 0x9e,
  IF_ICMPEQ: 0x9f,
  IF_ICMPNE: 0xa0,
  IF_ICMPLT: 0xa1,
  IF_ICMPGE: 0xa2,
  IF_ICMPGT: 0xa3,
  IF_ICMPLE: 0xa4,
  GOTO: 0xa7,
  IRETURN: 0xac,
  RETURN: 0xb1,
  GETSTATIC: 0xb2,
  INVOKEVIRTUAL: 0xb6,
  INVOKESPECIAL: 0xb7,
  INVOKESTATIC: 0xb8,
  POP: 0x57,
  DUP: 0x59,
  ICONST_M1: 0x02,
  ICONST_0: 0x03,
  ICONST_1: 0x04,
  ICONST_2: 0x05,
  ICONST_3: 0x06,
  ICONST_4: 0x07,
  ICONST_5: 0x08,
}

class Reader {
  constructor(bytes) {
    this.b = bytes
    this.p = 0
  }
  u1() {
    return this.b[this.p++]
  }
  u2() {
    const v = (this.b[this.p] << 8) | this.b[this.p + 1]
    this.p += 2
    return v
  }
  u4() {
    const v =
      ((this.b[this.p] << 24) >>> 0) +
      (this.b[this.p + 1] << 16) +
      (this.b[this.p + 2] << 8) +
      this.b[this.p + 3]
    this.p += 4
    return v
  }
  bytes(n) {
    const v = this.b.slice(this.p, this.p + n)
    this.p += n
    return v
  }
}

const decoder = new TextDecoder('utf-8')

export function parseClass(buffer) {
  const r = new Reader(new Uint8Array(buffer))
  const magic = r.u4()
  if (magic !== 0xcafebabe) throw new Error('not a class file')
  const minor = r.u2()
  const major = r.u2()
  const cpCount = r.u2()
  const cp = new Array(cpCount)
  for (let i = 1; i < cpCount; i++) {
    const tag = r.u1()
    switch (tag) {
      case 1: {
        const len = r.u2()
        cp[i] = { tag, value: decoder.decode(r.bytes(len)) }
        break
      }
      case 3:
        cp[i] = { tag, value: r.u4() | 0 }
        break
      case 4:
        cp[i] = { tag, value: new Float32Array(new Uint32Array([r.u4()]).buffer)[0] }
        break
      case 5:
        cp[i] = { tag, value: Number(r.u4()) * 4294967296 + r.u4() }
        i++
        break
      case 6: {
        const hi = r.u4()
        const lo = r.u4()
        const buf = new ArrayBuffer(8)
        const dv = new DataView(buf)
        dv.setUint32(0, hi)
        dv.setUint32(4, lo)
        cp[i] = { tag, value: dv.getFloat64(0) }
        i++
        break
      }
      case 7:
      case 8:
      case 16:
      case 19:
      case 20:
        cp[i] = { tag, index: r.u2() }
        break
      case 9:
      case 10:
      case 11:
      case 12:
      case 17:
      case 18:
        cp[i] = { tag, a: r.u2(), b: r.u2() }
        break
      case 15:
        cp[i] = { tag, a: r.u1(), b: r.u2() }
        break
      default:
        throw new Error('unsupported constant tag ' + tag)
    }
  }

  r.u2() // access
  const thisClass = r.u2()
  const superIdx = r.u2()
  const superName = superIdx ? cp[cp[superIdx].index].value : null
  const interfaceCount = r.u2()
  const interfaceNames = []
  for (let i = 0; i < interfaceCount; i++) {
    const idx = r.u2()
    interfaceNames.push(cp[cp[idx].index].value)
  }

  const skipMembers = () => {
    const count = r.u2()
    for (let i = 0; i < count; i++) {
      r.u2()
      r.u2()
      r.u2()
      const attrs = r.u2()
      for (let a = 0; a < attrs; a++) {
        r.u2()
        r.u4() && r.bytes(r.u4())
      }
    }
  }
  // fields
  const readElementValue = (r) => {
    const tag = String.fromCharCode(r.u1())
    switch (tag) {
      case 's': return cp[r.u2()].value
      case 'I':
      case 'J':
      case 'Z':
      case 'B':
      case 'C':
      case 'S':
      case 'D':
      case 'F':
        return cp[r.u2()].value
      case 'e': {
        r.u2()
        return cp[r.u2()].value
      }
      case 'c': {
        const idx = r.u2()
        return { classDesc: cp[idx].value }
      }
      case '@':
        return readAnnotation(r)
      case '[': {
        const n = r.u2()
        const arr = []
        for (let i = 0; i < n; i++) arr.push(readElementValue(r))
        return arr
      }
      default:
        return null
    }
  }
  const readAnnotation = (r) => {
    const type = cp[r.u2()].value
    const n = r.u2()
    const values = {}
    for (let i = 0; i < n; i++) {
      const name = cp[r.u2()].value
      values[name] = readElementValue(r)
    }
    return { type, values }
  }
  const readAnnotations = (r) => {
    const n = r.u2()
    const list = []
    for (let i = 0; i < n; i++) list.push(readAnnotation(r))
    return list
  }

  const fields = []
  const fieldCount = r.u2()
  for (let i = 0; i < fieldCount; i++) {
    const access = r.u2()
    const nameIdx = r.u2()
    const descIdx = r.u2()
    const attrs = r.u2()
    let annotations = []
    for (let a = 0; a < attrs; a++) {
      const attrName = cp[r.u2()].value
      const len = r.u4()
      const start = r.p
      if (attrName === 'RuntimeVisibleAnnotations' || attrName === 'RuntimeInvisibleAnnotations') annotations = annotations.concat(readAnnotations(r))
      r.p = start + len
    }
    fields.push({ access, name: cp[nameIdx].value, desc: cp[descIdx].value, annotations })
  }

  const methods = []
  const methodCount = r.u2()
  for (let i = 0; i < methodCount; i++) {
    const access = r.u2()
    const nameIdx = r.u2()
    const descIdx = r.u2()
    const attrs = r.u2()
    let code = null
    let annotations = []
    let signature = null
    for (let a = 0; a < attrs; a++) {
      const name = cp[r.u2()].value
      const len = r.u4()
      const attrStart = r.p
      if (name === 'Code') {
        const start = r.p
        const maxStack = r.u2()
        const maxLocals = r.u2()
        const codeLen = r.u4()
        const bytes = r.bytes(codeLen)
        const exCount = r.u2()
        const exceptions = []
        for (let e = 0; e < exCount; e++) {
          const startPc = r.u2()
          const endPc = r.u2()
          const handlerPc = r.u2()
          const catchIdx = r.u2()
          exceptions.push({
            startPc,
            endPc,
            handlerPc,
            catchType: catchIdx ? cp[cp[catchIdx].index].value : null,
          })
        }
        const subAttrs = r.u2()
        for (let s = 0; s < subAttrs; s++) {
          r.u2()
          const l = r.u4()
          r.bytes(l)
        }
        r.p = start + len
        code = { maxStack, maxLocals, bytes, exceptions }
      } else if (name === 'RuntimeVisibleAnnotations' || name === 'RuntimeInvisibleAnnotations') {
        annotations = annotations.concat(readAnnotations(r))
      } else if (name === 'Signature') {
        signature = cp[r.u2()].value
      } else {
        r.bytes(len)
      }
      r.p = attrStart + len
    }
    methods.push({
      access,
      name: cp[nameIdx].value,
      desc: cp[descIdx].value,
      code,
      annotations,
      signature,
    })
  }

  const bootstrapMethods = []
  let classAnnotations = []
  let classSignature = null
  let innerClasses = []
  const classAttrCount = r.u2()
  for (let i = 0; i < classAttrCount; i++) {
    const attrName = cp[r.u2()].value
    const len = r.u4()
    const start = r.p
    if (attrName === 'BootstrapMethods') {
      const n = r.u2()
      for (let b = 0; b < n; b++) {
        const ref = r.u2()
        const argCount = r.u2()
        const args = []
        for (let a = 0; a < argCount; a++) args.push(r.u2())
        bootstrapMethods.push({ ref, args })
      }
    } else if (attrName === 'RuntimeVisibleAnnotations' || attrName === 'RuntimeInvisibleAnnotations') {
      classAnnotations = classAnnotations.concat(readAnnotations(r))
    } else if (attrName === 'Signature') {
      classSignature = cp[r.u2()].value
    } else if (attrName === 'InnerClasses') {
      const n = r.u2()
      for (let k = 0; k < n; k++) {
        const inner = r.u2()
        const outer = r.u2()
        const innerName = r.u2()
        const access = r.u2()
        innerClasses.push({
          inner: inner ? cp[cp[inner].index].value : null,
          outer: outer ? cp[cp[outer].index].value : null,
          name: innerName ? cp[innerName].value : null,
          access,
        })
      }
    }
    r.p = start + len
  }

  return {
    minor,
    major,
    cp,
    fields,
    thisName: cp[cp[thisClass].index].value,
    superName,
    interfaceNames,
    bootstrapMethods,
    annotations: classAnnotations,
    signature: classSignature,
    innerClasses,
    methods,
  }
}

export function methodRef(cls, cp, index) {
  const ref = cp[index]
  const classEntry = cp[ref.a]
  const nt = cp[ref.b]
  return {
    cls: cp[classEntry.index].value,
    name: cp[nt.a].value,
    desc: cp[nt.b].value,
  }
}

export function fieldRef(cls, cp, index) {
  const ref = cp[index]
  const classEntry = cp[ref.a]
  const nt = cp[ref.b]
  return {
    cls: cp[classEntry.index].value,
    name: cp[nt.a].value,
    desc: cp[nt.b].value,
  }
}

const PRINTER = { __printer: true }

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

export function createVM(cls) {
  const out = []
  const methodsByName = new Map()
  for (const m of cls.methods) methodsByName.set(m.name + m.desc, m)
  let steps = 0

  function invoke(method, args) {
    if (!method.code) throw new Error('native method: ' + method.name)
    const locals = new Array(Math.max(method.code.maxLocals, args.length))
    for (let i = 0; i < args.length; i++) locals[i] = args[i]
    const stack = []
    const code = method.code.bytes
    let pc = 0

    const push = (v) => stack.push(v)
    const pop = () => stack.pop()

    while (pc < code.length) {
      if (++steps > 20_000_000) throw new Error('step limit exceeded')
      const op = code[pc++]
      switch (op) {
        case OP.ICONST_M1: push(-1); break
        case OP.ICONST_0: push(0); break
        case OP.ICONST_1: push(1); break
        case OP.ICONST_2: push(2); break
        case OP.ICONST_3: push(3); break
        case OP.ICONST_4: push(4); break
        case OP.ICONST_5: push(5); break
        case OP.BIPUSH: push((code[pc++] << 24) >> 24); break
        case OP.SIPUSH: {
          const v = (code[pc] << 8) | code[pc + 1]
          pc += 2
          push((v << 16) >> 16)
          break
        }
        case OP.LDC: {
          const idx = code[pc++]
          push(constant(idx))
          break
        }
        case OP.LDC_W: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          push(constant(idx))
          break
        }
        case OP.ILOAD: push(locals[code[pc++]]); break
        case OP.ILOAD_0: push(locals[0]); break
        case OP.ILOAD_1: push(locals[1]); break
        case OP.ILOAD_2: push(locals[2]); break
        case OP.ILOAD_3: push(locals[3]); break
        case OP.ISTORE: locals[code[pc++]] = pop(); break
        case OP.ISTORE_0: locals[0] = pop(); break
        case OP.ISTORE_1: locals[1] = pop(); break
        case OP.ISTORE_2: locals[2] = pop(); break
        case OP.ISTORE_3: locals[3] = pop(); break
        case OP.IADD: { const b = pop(); const a = pop(); push((a + b) | 0); break }
        case OP.ISUB: { const b = pop(); const a = pop(); push((a - b) | 0); break }
        case OP.IMUL: { const b = pop(); const a = pop(); push((a * b) | 0); break }
        case OP.IDIV: { const b = pop(); const a = pop(); push((a / b) | 0); break }
        case OP.IREM: { const b = pop(); const a = pop(); push(a % b); break }
        case OP.INEG: push(-pop()); break
        case OP.IINC: {
          const idx = code[pc++]
          const inc = (code[pc++] << 24) >> 24
          locals[idx] = (locals[idx] + inc) | 0
          break
        }
        case OP.IFEQ: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v === 0) pc += off - 3; break }
        case OP.IFNE: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v !== 0) pc += off - 3; break }
        case OP.IFLT: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v < 0) pc += off - 3; break }
        case OP.IFGE: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v >= 0) pc += off - 3; break }
        case OP.IFGT: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v > 0) pc += off - 3; break }
        case OP.IFLE: { const v = pop(); const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16; pc += 2; if (v <= 0) pc += off - 3; break }
        case OP.IF_ICMPEQ: case OP.IF_ICMPNE: case OP.IF_ICMPLT:
        case OP.IF_ICMPGE: case OP.IF_ICMPGT: case OP.IF_ICMPLE: {
          const b = pop()
          const a = pop()
          const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16
          pc += 2
          const ok =
            (op === OP.IF_ICMPEQ && a === b) ||
            (op === OP.IF_ICMPNE && a !== b) ||
            (op === OP.IF_ICMPLT && a < b) ||
            (op === OP.IF_ICMPGE && a >= b) ||
            (op === OP.IF_ICMPGT && a > b) ||
            (op === OP.IF_ICMPLE && a <= b)
          if (ok) pc += off - 3
          break
        }
        case OP.GOTO: {
          const off = (((code[pc] << 8) | code[pc + 1]) << 16) >> 16
          pc += 2
          pc += off - 3
          break
        }
        case OP.GETSTATIC: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const f = fieldRef(cls, cls.cp, idx)
          if (f.cls === 'java/lang/System' && f.name === 'out') push(PRINTER)
          else throw new Error('unsupported field ' + f.cls + '.' + f.name)
          break
        }
        case OP.INVOKESTATIC: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const ref = methodRef(cls, cls.cp, idx)
          const n = argCount(ref.desc)
          const args = new Array(n)
          for (let i = n - 1; i >= 0; i--) args[i] = pop()
          const target =
            ref.cls === cls.thisName
              ? methodsByName.get(ref.name + ref.desc)
              : methodsByName.get(ref.name + ref.desc)
          if (!target) throw new Error('method not found ' + ref.cls + '.' + ref.name + ref.desc)
          const result = invoke(target, args)
          if (ref.desc.endsWith(')V') === false) push(result)
          break
        }
        case OP.INVOKEVIRTUAL: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const ref = methodRef(cls, cls.cp, idx)
          const n = argCount(ref.desc)
          const args = new Array(n)
          for (let i = n - 1; i >= 0; i--) args[i] = pop()
          const recv = pop()
          if (ref.cls === 'java/io/PrintStream' && recv === PRINTER) {
            out.push(String(args[0]))
          } else if (ref.name === '<init>') {
            // no-op
          } else {
            throw new Error('unsupported virtual call ' + ref.cls + '.' + ref.name)
          }
          break
        }
        case OP.INVOKESPECIAL: {
          const idx = (code[pc] << 8) | code[pc + 1]
          pc += 2
          const ref = methodRef(cls, cls.cp, idx)
          const n = argCount(ref.desc)
          for (let i = 0; i < n; i++) pop()
          pop()
          if (ref.name !== '<init>') throw new Error('unsupported special call ' + ref.name)
          break
        }
        case OP.ALOAD_0: push(locals[0]); break
        case OP.POP: pop(); break
        case OP.DUP: { const v = pop(); push(v); push(v); break }
        case OP.IRETURN: return pop()
        case OP.RETURN: return undefined
        default:
          throw new Error('unsupported opcode 0x' + op.toString(16) + ' at ' + (pc - 1))
      }
    }
    return undefined
  }

  function constant(idx) {
    const c = cls.cp[idx]
    if (!c) throw new Error('bad constant ' + idx)
    if (c.tag === 8) return cls.cp[c.index].value
    return c.value
  }

  return {
    major: cls.major,
    minor: cls.minor,
    methodCount: cls.methods.length,
    out,
    runMain(className) {
      const main = cls.methods.find((m) => m.name === 'main' && m.desc === '([Ljava/lang/String;)V')
      if (!main) throw new Error('main not found')
      invoke(main, [null])
      return out
    },
  }
}
