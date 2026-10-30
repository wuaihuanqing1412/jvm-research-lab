import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;

import java.lang.reflect.Field;

public class DebugAsm {
  public static void main(String[] args) throws Exception {
    ClassWriter cw = new ClassWriter(0);
    Field f = ClassWriter.class.getDeclaredField("symbolTable");
    f.setAccessible(true);
    Object table = f.get(cw);
    System.out.println(table == null ? "NULL" : table.getClass().getName());

    MethodVisitor mv = cw.visitMethod(1, "x", "()V", null, null);
    Field sf = mv.getClass().getDeclaredField("symbolTable");
    sf.setAccessible(true);
    Object mt = sf.get(mv);
    System.out.println(mt == null ? "MV_NULL" : mt.getClass().getName());
  }
}
