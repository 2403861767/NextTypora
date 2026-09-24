package com.nexttyproa.service;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Locale;
import java.util.stream.Stream;

@Service
public class FileService {

    private static final byte[] UTF8_BOM = new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    private static final String DEFAULT_ENCODING = "UTF-8";
    private static final int BINARY_SCAN_LIMIT = 8192;
    private static final String[] LEGACY_ENCODINGS = {"GBK", "Big5", "Shift_JIS"};

    /**
     * Normalize path separators to forward slashes for cross-platform consistency.
     * Converts all backslashes to forward slashes and removes leading slashes.
     *
     * @param path the path to normalize
     * @return normalized path with forward slashes, or empty string if path is null
     */
    public static String normalizePathSeparators(String path) {
        if (path == null) return "";
        return path.replace('\\', '/').replaceAll("^/+", "");
    }

    public Path resolveSafe(Path vaultRoot, String relativePath) throws IOException {
        String normalized = normalizePathSeparators(relativePath);
        Path root = vaultRoot.toAbsolutePath().normalize();
        Path resolved = root.resolve(normalized).normalize();
        if (!resolved.startsWith(root)) {
            throw new SecurityException("Path traversal detected: " + relativePath);
        }
        Path relative = root.relativize(resolved);
        if (relative.isAbsolute()) {
            throw new SecurityException("Path traversal detected: " + relativePath);
        }
        Path current = root;
        for (Path segment : relative) {
            if ("..".equals(segment.toString())) {
                throw new SecurityException("Path traversal detected: " + relativePath);
            }
            current = current.resolve(segment);
            if (Files.isSymbolicLink(current)) {
                throw new SecurityException("Symbolic links are not allowed in workspace paths: " + relativePath);
            }
        }
        return resolved;
    }

    public String readFile(Path file) throws IOException {
        return readFileWithEncoding(file).content();
    }

    public ReadFileResult readFileWithEncoding(Path file) throws IOException {
        byte[] bytes = Files.readAllBytes(file);
        if (looksBinary(bytes)) {
            throw new IOException("File appears to be binary and cannot be opened as Markdown: " + file);
        }

        boolean hasBom = startsWith(bytes, UTF8_BOM);
        byte[] body = hasBom ? java.util.Arrays.copyOfRange(bytes, UTF8_BOM.length, bytes.length) : bytes;
        if (hasBom) {
            return new ReadFileResult(decodeStrict(body, StandardCharsets.UTF_8), DEFAULT_ENCODING, true);
        }

        // A strict decode only proves the bytes are legal in that charset: short GBK text is often
        // valid UTF-8, and GBK accepts nearly all Big5/Shift_JIS byte pairs. So every candidate that
        // decodes is scored, and a legacy charset replaces UTF-8 only with a strictly higher score.
        String bestEncoding = null;
        String bestContent = null;
        double bestScore = -1;
        String utf8Content = tryDecode(body, StandardCharsets.UTF_8);
        if (utf8Content != null) {
            bestEncoding = DEFAULT_ENCODING;
            bestContent = utf8Content;
            bestScore = utf8Score(utf8Content);
        }

        for (String candidate : LEGACY_ENCODINGS) {
            String decoded = tryDecode(body, Charset.forName(candidate));
            if (decoded == null) {
                continue;
            }
            double score = legacyScore(body, candidate);
            if (score > bestScore) {
                bestEncoding = candidate;
                bestContent = decoded;
                bestScore = score;
            }
        }

        if (bestEncoding == null) {
            throw new IOException("Unsupported or corrupt text encoding: " + file);
        }
        return new ReadFileResult(bestContent, bestEncoding, false);
    }

    public void writeFile(Path file, String content) throws IOException {
        writeFileAtomic(file, content);
    }

    public void writeFileAtomic(Path file, String content) throws IOException {
        writeFileAtomic(file, content, DEFAULT_ENCODING, false, false);
    }

    public void writeFileAtomic(Path file, String content, String encoding, boolean hasBom, boolean backupExisting) throws IOException {
        if (Files.exists(file) && !Files.isWritable(file)) {
            throw new IOException("File is read-only: " + file);
        }
        Path parent = file.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        if (backupExisting && Files.exists(file)) {
            backupFile(file);
        }
        String safeContent = content == null ? "" : content;
        Path temp = Files.createTempFile(parent != null ? parent : file.toAbsolutePath().getParent(), ".nexttyproa-", ".tmp");
        try {
            String normalizedEncoding = normalizeEncodingName(encoding);
            byte[] encoded = safeContent.getBytes(Charset.forName(normalizedEncoding));
            if (hasBom && DEFAULT_ENCODING.equalsIgnoreCase(normalizedEncoding)) {
                byte[] withBom = new byte[UTF8_BOM.length + encoded.length];
                System.arraycopy(UTF8_BOM, 0, withBom, 0, UTF8_BOM.length);
                System.arraycopy(encoded, 0, withBom, UTF8_BOM.length, encoded.length);
                encoded = withBom;
            }
            Files.write(temp, encoded);
            try {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    public void backupFile(Path file) throws IOException {
        if (!Files.exists(file) || Files.isDirectory(file)) {
            return;
        }
        Path parent = file.getParent() == null ? file.toAbsolutePath().getParent() : file.getParent();
        Path backupDir = parent.resolve(".nexttyproa-backups");
        Files.createDirectories(backupDir);
        String timestamp = Instant.now().toString().replace(":", "").replace(".", "-");
        String fileName = file.getFileName().toString();
        Files.copy(file, backupDir.resolve(fileName + "." + timestamp + ".bak"), StandardCopyOption.REPLACE_EXISTING);
    }

    public String hashContent(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest((content == null ? "" : content).getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                builder.append(String.format("%02x", b));
            }
            return builder.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    public void deleteFile(Path file) throws IOException {
        Files.deleteIfExists(file);
    }

    public boolean exists(Path file) {
        return Files.exists(file);
    }

    public boolean isMarkdownPath(String path) {
        if (path == null) {
            return false;
        }
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.endsWith(".md") || lower.endsWith(".markdown");
    }

    public Path toVaultRelative(Path vaultRoot, Path absolute) {
        return vaultRoot.relativize(absolute.normalize());
    }

    public String relativePathString(Path vaultRoot, Path absolute) {
        return normalizePathSeparators(toVaultRelative(vaultRoot, absolute).toString());
    }

    public void deleteEmptyParents(Path vaultRoot, Path file) throws IOException {
        Path parent = file.getParent();
        while (parent != null && parent.startsWith(vaultRoot) && !parent.equals(vaultRoot)) {
            try (Stream<Path> entries = Files.list(parent)) {
                if (entries.findAny().isPresent()) {
                    break;
                }
            }
            Files.delete(parent);
            parent = parent.getParent();
        }
    }

    public static String extractTitle(String relativePath, String content) {
        if (content != null && !content.isBlank()) {
            String firstLine = content.lines().findFirst().orElse("").trim();
            if (firstLine.startsWith("# ")) {
                return firstLine.substring(2).trim();
            }
            if (!firstLine.isEmpty()) {
                return firstLine.length() > 80 ? firstLine.substring(0, 80) : firstLine;
            }
        }
        String fileName = Paths.get(relativePath).getFileName().toString();
        String lowerFileName = fileName.toLowerCase(Locale.ROOT);
        if (lowerFileName.endsWith(".markdown")) {
            return fileName.substring(0, fileName.length() - ".markdown".length());
        }
        if (lowerFileName.endsWith(".md")) {
            return fileName.substring(0, fileName.length() - 3);
        }
        return fileName;
    }

    public String normalizeEncodingName(String encoding) {
        if (encoding == null || encoding.isBlank()) {
            return DEFAULT_ENCODING;
        }
        String normalized = encoding.trim();
        if ("UTF8".equalsIgnoreCase(normalized) || "UTF-8-BOM".equalsIgnoreCase(normalized)) {
            return DEFAULT_ENCODING;
        }
        Charset.forName(normalized);
        return normalized;
    }

    private static boolean startsWith(byte[] value, byte[] prefix) {
        if (value.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (value[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static boolean looksBinary(byte[] bytes) {
        int limit = Math.min(bytes.length, BINARY_SCAN_LIMIT);
        for (int i = 0; i < limit; i++) {
            if (bytes[i] == 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Share of non-ASCII code points that are plausible in real text. Misread GBK bytes land in
     * U+0080-U+07FF blocks such as IPA, combining marks or archaic Cyrillic, which score as implausible.
     */
    private static double utf8Score(String content) {
        int total = 0;
        int plausible = 0;
        for (int cp : content.codePoints().toArray()) {
            if (cp < 0x80) {
                continue;
            }
            total++;
            if (isPlausibleUtf8CodePoint(cp)) {
                plausible++;
            }
        }
        return total == 0 ? 1.0 : (double) plausible / total;
    }

    private static boolean isPlausibleUtf8CodePoint(int cp) {
        if (cp >= 0x0800) {
            return !(cp >= 0xE000 && cp <= 0xF8FF) && cp != 0xFFFD;
        }
        return (cp >= 0x00A0 && cp <= 0x024F)      // Latin-1 printable, Latin Extended-A/B
                || (cp >= 0x0386 && cp <= 0x03CE)  // Greek
                || (cp >= 0x0400 && cp <= 0x045F)  // Cyrillic
                || (cp >= 0x05D0 && cp <= 0x05EA)  // Hebrew letters
                || (cp >= 0x0600 && cp <= 0x06FF); // Arabic
    }

    /**
     * Share of non-ASCII characters that fall in the core range of the given double-byte charset
     * (GB2312 level-1, Big5 common characters, JIS level-1), where real text overwhelmingly lives.
     */
    private static double legacyScore(byte[] bytes, String encoding) {
        int total = 0;
        int common = 0;
        int i = 0;
        while (i < bytes.length) {
            int lead = bytes[i] & 0xFF;
            if (lead < 0x80) {
                i++;
                continue;
            }
            total++;
            if ("Shift_JIS".equals(encoding) && lead >= 0xA1 && lead <= 0xDF) {
                i++; // single-byte half-width katakana
                continue;
            }
            int trail = i + 1 < bytes.length ? bytes[i + 1] & 0xFF : 0;
            if (isCommonLegacyPair(encoding, lead, trail)) {
                common++;
            }
            i += 2;
        }
        return total == 0 ? 0 : (double) common / total;
    }

    private static boolean isCommonLegacyPair(String encoding, int lead, int trail) {
        return switch (encoding) {
            case "GBK" -> ((lead >= 0xA1 && lead <= 0xA3) || (lead >= 0xB0 && lead <= 0xD7))
                    && trail >= 0xA1 && trail <= 0xFE;
            case "Big5" -> lead >= 0xA1 && lead <= 0xC6;
            case "Shift_JIS" -> (lead >= 0x81 && lead <= 0x83) || (lead >= 0x88 && lead <= 0x98);
            default -> false;
        };
    }

    private static String tryDecode(byte[] bytes, Charset charset) {
        try {
            return decodeStrict(bytes, charset);
        } catch (IOException e) {
            return null;
        }
    }

    private static String decodeStrict(byte[] bytes, Charset charset) throws IOException {
        CharsetDecoder decoder = charset.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            CharBuffer decoded = decoder.decode(ByteBuffer.wrap(bytes));
            return decoded.toString();
        } catch (CharacterCodingException e) {
            throw new IOException("Failed to decode as " + charset.name(), e);
        }
    }

    public record ReadFileResult(String content, String encoding, boolean hasBom) {
    }
}
