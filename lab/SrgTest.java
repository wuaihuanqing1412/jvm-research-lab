import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.lang.reflect.Method;

public class SrgTest {
  static byte[] targetClass() {
    ClassWriter cw = new ClassWriter(0);
    cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, "SrgTarget", null, "java/lang/Object", null);

    MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
    ctor.visitCode();
    ctor.visitVarInsn(Opcodes.ALOAD, 0);
    ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
    ctor.visitInsn(Opcodes.RETURN);
    ctor.visitMaxs(1, 1);
    ctor.visitEnd();

    MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC, "m_999_", "()I", null, null);
    mv.visitCode();
    mv.visitIntInsn(Opcodes.BIPUSH, 7);
    mv.visitInsn(Opcodes.IRETURN);
    mv.visitMaxs(1, 1);
    mv.visitEnd();

    cw.visitEnd();
    return cw.toByteArray();
  }

  static byte[] callerClass() {
    ClassWriter cw = new ClassWriter(0);
    cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, "SrgCaller", null, "java/lang/Object", null);

    MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "main", "([Ljava/lang/String;)V", null, null);
    mv.visitCode();
    mv.visitTypeInsn(Opcodes.NEW, "SrgTarget");
    mv.visitInsn(Opcodes.DUP);
    mv.visitMethodInsn(Opcodes.INVOKESPECIAL, "SrgTarget", "<init>", "()V", false);
    mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "SrgTarget", "hello", "()I", false);
    mv.visitMethodInsn(Opcodes.INVOKESTATIC, "Helper", "print", "(I)V", false);
    mv.visitInsn(Opcodes.RETURN);
    mv.visitMaxs(2, 1);
    mv.visitEnd();

    cw.visitEnd();
    return cw.toByteArray();
  }

  static Class<?> define(String name, byte[] bytes) throws Exception {
    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);
    return (Class<?>) define.invoke(cl, name, bytes, 0, bytes.length);
  }

  public static void main(String[] args) throws Exception {
    define("SrgTarget", targetClass());
    Class<?> caller = define("SrgCaller", callerClass());
    Method main = caller.getMethod("main", String[].class);
    main.invoke(null, new Object[] { new String[0] });
  }
}
