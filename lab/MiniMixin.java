import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

public class MiniMixin {
  public static byte[] inject(byte[] target, String methodName, String hookOwner) {
    ClassReader cr = new ClassReader(target);
    ClassNode cn = new ClassNode();
    cr.accept(cn, ClassReader.SKIP_FRAMES);

    for (MethodNode mn : cn.methods) {
      if (!mn.name.equals(methodName)) continue;

      InsnList head = new InsnList();
      head.add(new VarInsnNode(Opcodes.ALOAD, 0));
      head.add(new MethodInsnNode(Opcodes.INVOKESTATIC, hookOwner, "before", "(Ljava/lang/Object;)V", false));
      mn.instructions.insert(head);

      AbstractInsnNode ret = mn.instructions.getLast();
      InsnList tail = new InsnList();
      tail.add(new VarInsnNode(Opcodes.ALOAD, 0));
      tail.add(new MethodInsnNode(Opcodes.INVOKESTATIC, hookOwner, "beforeReturn", "(Ljava/lang/Object;)V", false));
      mn.instructions.insertBefore(ret, tail);

      mn.maxStack = Math.max(mn.maxStack, 2);
    }

    ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
    cn.accept(cw);
    return cw.toByteArray();
  }
}
