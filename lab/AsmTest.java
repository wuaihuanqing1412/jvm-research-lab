import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.lang.reflect.Method;

public class AsmTest {
  public static void main(String[] args) throws Exception {
    ClassWriter cw = new ClassWriter(0);
    cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, "Generated", null, "java/lang/Object", null);

    MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "hello", "()I", null, null);
    mv.visitCode();
    mv.visitIntInsn(Opcodes.BIPUSH, 77);
    mv.visitInsn(Opcodes.IRETURN);
    mv.visitMaxs(1, 0);
    mv.visitEnd();
    cw.visitEnd();

    byte[] bytes = cw.toByteArray();

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);

    Class<?> c = (Class<?>) define.invoke(cl, "Generated", bytes, 0, bytes.length);
    Method hello = c.getMethod("hello");
    System.out.println(hello.invoke(null));
  }
}
