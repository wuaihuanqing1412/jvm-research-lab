import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.io.InputStream;
import java.lang.reflect.Method;

public class TransformTest {
  public static void main(String[] args) throws Exception {
    InputStream in = TransformTest.class.getResourceAsStream("/dynamic.bin");
    byte[] original = in.readAllBytes();

    ClassReader cr = new ClassReader(original);
    ClassWriter cw = new ClassWriter(0);

    ClassVisitor cv = new ClassVisitor(Opcodes.ASM9, cw) {
      @Override
      public MethodVisitor visitMethod(int access, String name, String desc, String sig, String[] ex) {
        MethodVisitor target = super.visitMethod(access, name, desc, sig, ex);
        if (!name.equals("answer")) return target;
        return new MethodVisitor(Opcodes.ASM9) {
          @Override
          public void visitCode() {
            target.visitCode();
            target.visitIntInsn(Opcodes.BIPUSH, 123);
            target.visitInsn(Opcodes.IRETURN);
            target.visitMaxs(1, 1);
          }

          @Override
          public void visitEnd() {
            target.visitEnd();
          }
        };
      }
    };

    cr.accept(cv, 0);
    byte[] transformed = cw.toByteArray();

    ClassLoader cl = ClassLoader.getSystemClassLoader();
    Method define = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    define.setAccessible(true);

    Class<?> c = (Class<?>) define.invoke(cl, "Dynamic", transformed, 0, transformed.length);
    Object o = c.getDeclaredConstructor().newInstance();
    Method answer = c.getMethod("answer");
    System.out.println(answer.invoke(o));
  }
}
