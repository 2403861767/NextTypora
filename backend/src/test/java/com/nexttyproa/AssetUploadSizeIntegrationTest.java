package com.nexttyproa;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BUG_BACKLOG_REAL_WORLD.md RW-P1-008：粘贴超过 1 MB 的图片会失败（Spring 默认 multipart 上限 1 MB，映射成 500）。
 * MockMvc 不经过 Tomcat 的 multipart 解析、不会触发大小限制，所以这里启动真实的 HTTP 服务。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AssetUploadSizeIntegrationTest {

    private static final String TOKEN = "test-token";
    // 全屏 PNG 截图通常有 1–3 MB
    private static final int SCREENSHOT_BYTES = 1536 * 1024;

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @TempDir
    private Path vault;

    @Test
    void pastedScreenshotLargerThanOneMegabyteIsSavedNextToTheNote() throws Exception {
        byte[] screenshot = pngOfSize(SCREENSHOT_BYTES);

        ResponseEntity<Map> response = uploadToNewNote(rest, port, vault, screenshot);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        String assetPath = (String) response.getBody().get("path");
        assertThat(assetPath).startsWith("会议纪要.assets/");
        assertThat(response.getBody().get("markdownRef")).isEqualTo(assetPath);
        assertThat(vault.resolve(assetPath)).hasBinaryContent(screenshot);
    }

    /** 超过上限时要明确告诉前端原因（413），而不是当作后端内部错误（500） */
    @Nested
    @TestPropertySource(properties = {
            "spring.servlet.multipart.max-file-size=1MB",
            "spring.servlet.multipart.max-request-size=1MB",
    })
    class WhenTheImageExceedsTheUploadLimit {

        @LocalServerPort
        private int limitedPort;

        @Autowired
        private TestRestTemplate limitedRest;

        @TempDir
        private Path limitedVault;

        @Test
        void uploadIsRejectedWith413AndTheReasonInsteadOfAnInternalError() throws Exception {
            ResponseEntity<Map> response = uploadToNewNote(limitedRest, limitedPort, limitedVault, pngOfSize(SCREENSHOT_BYTES));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
            assertThat((String) response.getBody().get("error")).contains("exceeds its maximum permitted size");
            try (Stream<Path> files = Files.list(limitedVault)) {
                assertThat(files.map(path -> path.getFileName().toString())).containsExactly("会议纪要.md");
            }
        }
    }

    private static ResponseEntity<Map> uploadToNewNote(TestRestTemplate rest, int port, Path vault, byte[] image) throws Exception {
        Files.writeString(vault.resolve("会议纪要.md"), "# 会议纪要\n\n参会人：张三、李四\n");
        ResponseEntity<Map> workspace = rest.exchange(url(port, "/api/workspace"), HttpMethod.POST,
                new HttpEntity<>(Map.of("path", vault.toString()), headers(MediaType.APPLICATION_JSON)), Map.class);
        assertThat(workspace.getStatusCode()).isEqualTo(HttpStatus.OK);

        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("notePath", "会议纪要.md");
        form.add("file", new ByteArrayResource(image) {
            @Override
            public String getFilename() {
                return "big-screenshot.png";
            }
        });
        return rest.exchange(url(port, "/api/asset"), HttpMethod.POST,
                new HttpEntity<>(form, headers(MediaType.MULTIPART_FORM_DATA)), Map.class);
    }

    private static HttpHeaders headers(MediaType contentType) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Auth-Token", TOKEN);
        headers.setContentType(contentType);
        return headers;
    }

    // 服务只监听 127.0.0.1（application.yml 的 server.address）
    private static String url(int port, String path) {
        return "http://127.0.0.1:" + port + path;
    }

    private static byte[] pngOfSize(int size) {
        byte[] bytes = new byte[size];
        byte[] signature = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
        System.arraycopy(signature, 0, bytes, 0, signature.length);
        for (int i = signature.length; i < size; i++) {
            bytes[i] = (byte) (i * 31);
        }
        return bytes;
    }
}
