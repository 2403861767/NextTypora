package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.dto.ExportHtmlDto;
import com.nexttyproa.dto.ExportHtmlRequest;
import com.nexttyproa.exception.BadRequestException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExportServiceTest {

    private final FileService fileService = new FileService();

    @Test
    void extractsTitleFromYamlFrontmatter(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "frontmatter.md", """
                ---
                title: "Frontmatter Title"
                tags: [export]
                ---

                # Heading Title
                Body
                """);

        assertEquals("Frontmatter Title", exported.getTitle());
        assertTrue(exported.getHtml().contains("<pre class=\"frontmatter\"><code>title: &quot;Frontmatter Title&quot;"));
        assertTrue(exported.getHtml().contains("<h1>Heading Title</h1>"));
    }

    @Test
    void rendersGfmTables(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "tables.md", """
                | Name | Count |
                | --- | ---: |
                | Alpha | 2 |
                """);

        assertTrue(exported.getHtml().contains("<table>"));
        assertTrue(exported.getHtml().contains("<th>Name</th>"));
        assertTrue(exported.getHtml().contains("<td>Alpha</td>"));
    }

    @Test
    void rendersTaskLists(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "tasks.md", """
                - [x] Done
                - [ ] Todo
                """);

        assertTrue(exported.getHtml().contains("type=\"checkbox\""));
        assertTrue(exported.getHtml().contains("checked"));
        assertTrue(exported.getHtml().contains("Done"));
        assertTrue(exported.getHtml().contains("Todo"));
    }

    @Test
    void rendersFootnotes(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "footnotes.md", """
                A sentence with a note.[^first]

                [^first]: Footnote text
                """);

        assertTrue(exported.getHtml().contains("footnote"));
        assertTrue(exported.getHtml().contains("Footnote text"));
        assertTrue(exported.getHtml().contains("footnote-ref"));
    }

    @Test
    void rendersFencedCodeAndMermaidBlocksWithoutCdn(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "code.md", """
                ```java
                System.out.println("hi");
                ```

                ```mermaid
                graph TD
                  A-->B
                ```
                """);

        assertTrue(exported.getHtml().contains("class=\"language-java\""));
        assertTrue(exported.getHtml().contains("System.out.println(&quot;hi&quot;);"));
        assertTrue(exported.getHtml().contains("<pre class=\"mermaid\">"));
        assertTrue(exported.getHtml().contains("graph TD"));
        assertTrue(exported.getHtml().contains("window.__NEXTTYPROA_MERMAID_DONE__ = true"));
        assertFalse(exported.getHtml().contains("cdn.jsdelivr.net"));
    }

    @Test
    void preservesRelativeLocalAndRemoteImageLinks(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "images.md", """
                ![relative](images/pic.png)
                ![local](file:///C:/notes/pic.png)
                ![remote](https://example.com/pic.png)
                """);

        assertTrue(exported.getHtml().contains("src=\"images/pic.png\""));
        assertTrue(exported.getHtml().contains("src=\"file:///C:/notes/pic.png\""));
        assertTrue(exported.getHtml().contains("src=\"https://example.com/pic.png\""));
    }

    @Test
    void exportsEmptyMarkdownWithoutFailure(@TempDir Path vaultRoot) throws Exception {
        ExportHtmlDto exported = export(vaultRoot, "empty.md", "");

        assertEquals("empty", exported.getTitle());
        assertEquals("empty.md", exported.getPath());
        assertTrue(exported.getHtml().contains("<main>"));
        assertTrue(exported.getHtml().contains("</html>"));
    }

    @Test
    void rejectsNonMarkdownPaths(@TempDir Path vaultRoot) throws Exception {
        Files.writeString(vaultRoot.resolve("note.txt"), "# Nope", StandardCharsets.UTF_8);
        ExportService service = exportService(vaultRoot);
        ExportHtmlRequest request = request("note.txt");

        assertThrows(BadRequestException.class, () -> service.exportHtml(request));
    }

    @Test
    void rejectsPathTraversal(@TempDir Path vaultRoot) {
        ExportService service = exportService(vaultRoot);
        ExportHtmlRequest request = request("../outside.md");

        assertThrows(BadRequestException.class, () -> service.exportHtml(request));
    }

    private ExportHtmlDto export(Path vaultRoot, String relativePath, String markdown) throws Exception {
        Path file = vaultRoot.resolve(relativePath).normalize();
        Files.createDirectories(file.getParent() == null ? vaultRoot : file.getParent());
        Files.writeString(file, markdown, StandardCharsets.UTF_8);
        return exportService(vaultRoot).exportHtml(request(relativePath));
    }

    private ExportService exportService(Path vaultRoot) {
        AppProperties appProperties = new AppProperties();
        appProperties.setVaultPath(vaultRoot.toString());
        WorkspaceService workspaceService = new WorkspaceService(
                appProperties,
                fileService,
                new IndexService(fileService)
        );
        return new ExportService(workspaceService, fileService);
    }

    private ExportHtmlRequest request(String path) {
        ExportHtmlRequest request = new ExportHtmlRequest();
        request.setPath(path);
        return request;
    }
}
