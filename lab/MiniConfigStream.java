import java.io.InputStream;

public class MiniConfigStream extends InputStream {
  private final byte[] data;
  private int pos;

  public MiniConfigStream(String text) {
    data = new byte[text.length()];
    for (int i = 0; i < text.length(); i++) {
      data[i] = (byte) text.charAt(i);
    }
  }

  public int read() {
    return pos < data.length ? data[pos++] & 0xff : -1;
  }
}
