import com.android.ide.common.vectordrawable.Svg2Vector;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;

public class Svg2VectorShim {
  public static void main(String[] args) throws Exception {
    Path out = Path.of(args[0]);
    for (int i = 1; i < args.length; i++) {
      Path svg = Path.of(args[i]);
      String base = svg.getFileName().toString().replaceFirst("\\.svg$", "");
      try {
        ByteArrayOutputStream xml = new ByteArrayOutputStream();
        String log = Svg2Vector.parseSvgToXml(svg, xml);
        Files.write(out.resolve(base + ".xml"), xml.toByteArray());
        if (log != null && !log.isEmpty()) Files.writeString(out.resolve(base + ".log"), log);
      } catch (Throwable e) {
        Files.writeString(out.resolve(base + ".log"), String.valueOf(e.getMessage()));
      }
    }
  }
}
