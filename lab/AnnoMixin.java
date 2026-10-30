import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.AnnotationNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import java.util.List;

public class AnnoMixin {
  static String value(List<AnnotationNode> list, String desc, String key, String fallback) {
    if (list == null) return fallback;
    for (AnnotationNode node : list) {
      if (!node.desc.equals(desc) || node.values == null) continue;
      for (int i = 0; i + 1 < node.values.size(); i += 2) {
        if (key.equals(node.values.get(i))) return String.valueOf(node.values.get(i + 1));
      }
    }
    return fallback;
  }

  public static byte[] transform(byte[] target, byte[] mixinBytes) {
    ClassNode targetNode = new ClassNode();
    new ClassReader(target).accept(targetNode, ClassReader.SKIP_FRAMES);

    ClassNode mixinNode = new ClassNode();
    new ClassReader(mixinBytes).accept(mixinNode, ClassReader.SKIP_FRAMES);

    String mixinTarget = value(mixinNode.visibleAnnotations, "LMixin;", "value", "");
    if (!targetNode.name.equals(mixinTarget)) {
      throw new IllegalArgumentException("mixin target mismatch: " + mixinTarget + " vs " + targetNode.name);
    }

    for (MethodNode mixinMethod : mixinNode.methods) {
      String methodName = value(mixinMethod.visibleAnnotations, "LInject;", "method", null);
      if (methodName == null) continue;
      String at = value(mixinMethod.visibleAnnotations, "LInject;", "at", "HEAD");

      for (MethodNode targetMethod : targetNode.methods) {
        if (!targetMethod.name.equals(methodName)) continue;

        InsnList call = new InsnList();
        call.add(new org.objectweb.asm.tree.VarInsnNode(Opcodes.ALOAD, 0));
        call.add(new MethodInsnNode(Opcodes.INVOKESTATIC, mixinNode.name, mixinMethod.name, "(Ljava/lang/Object;)V", false));

        if ("HEAD".equals(at)) {
          targetMethod.instructions.insert(call);
        } else {
          AbstractInsnNode ret = targetMethod.instructions.getLast();
          targetMethod.instructions.insertBefore(ret, call);
        }
        targetMethod.maxStack = Math.max(targetMethod.maxStack, 2);
      }
    }

    ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
    targetNode.accept(cw);
    return cw.toByteArray();
  }
}
