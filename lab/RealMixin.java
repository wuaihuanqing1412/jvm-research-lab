package testmix;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(targets = "Dynamic")
public class RealMixin {
  @Inject(method = "answer", at = @At("HEAD"))
  private void onHead(CallbackInfoReturnable<Integer> cir) {
    System.out.println("real mixin HEAD");
  }

  @Inject(method = "answer", at = @At("RETURN"))
  private void onReturn(CallbackInfoReturnable<Integer> cir) {
    System.out.println("real mixin RETURN");
  }
}
