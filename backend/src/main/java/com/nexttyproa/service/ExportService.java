package com.nexttyproa.service;

import com.nexttyproa.dto.ExportHtmlDto;
import com.nexttyproa.dto.ExportHtmlRequest;
import com.nexttyproa.exception.BadRequestException;
import com.nexttyproa.exception.NotFoundException;
import com.vladsch.flexmark.ext.autolink.AutolinkExtension;
import com.vladsch.flexmark.ext.footnotes.FootnoteExtension;
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension;
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension;
import com.vladsch.flexmark.ext.tables.TablesExtension;
import com.vladsch.flexmark.ext.yaml.front.matter.YamlFrontMatterExtension;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.ast.Document;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

@Service
public class ExportService {

    private static final MutableDataSet FLEXMARK_OPTIONS = new MutableDataSet()
            .set(Parser.EXTENSIONS, List.of(
                    TablesExtension.create(),
                    TaskListExtension.create(),
                    FootnoteExtension.create(),
                    YamlFrontMatterExtension.create(),
                    StrikethroughExtension.create(),
                    AutolinkExtension.create()
            ));
    private static final Parser MARKDOWN_PARSER = Parser.builder(FLEXMARK_OPTIONS).build();
    private static final HtmlRenderer HTML_RENDERER = HtmlRenderer.builder(FLEXMARK_OPTIONS).build();

    private final WorkspaceService workspaceService;
    private final FileService fileService;

    public ExportService(WorkspaceService workspaceService, FileService fileService) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
    }

    public ExportHtmlDto exportHtml(ExportHtmlRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(request.getPath());
        if (!fileService.isMarkdownPath(normalized)) {
            throw new BadRequestException("Only Markdown files are supported: " + normalized);
        }

        Path file = resolveSafe(vaultRoot, normalized);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new NotFoundException("Note not found: " + request.getPath());
        }
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new BadRequestException("Path is not a file: " + normalized);
        }

        String markdown = fileService.readFile(file);
        String title = extractExportTitle(normalized, markdown);
        String body = renderMarkdown(markdown);
        String html = standaloneHtml(title, body);
        return new ExportHtmlDto(normalized, title, html);
    }

    private String renderMarkdown(String markdown) {
        String content = normalizeLineEndings(markdown);
        Document document = MARKDOWN_PARSER.parse(content);
        return renderFrontmatterBlock(content) + normalizeFlexmarkHtml(HTML_RENDERER.render(document));
    }

    private String normalizeFlexmarkHtml(String html) {
        return html
                .replaceAll(
                "(?s)<pre><code class=\"language-mermaid\">(.*?)</code></pre>",
                "<pre class=\"mermaid\">$1</pre>"
                )
                .replaceAll("<img([^>]*?) />", "<img$1>")
                .replace(
                        "<input type=\"checkbox\" class=\"task-list-item-checkbox\" checked=\"checked\" disabled=\"disabled\" readonly=\"readonly\" />&nbsp;",
                        "<input type=\"checkbox\" disabled checked> "
                )
                .replace(
                        "<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled=\"disabled\" readonly=\"readonly\" />&nbsp;",
                        "<input type=\"checkbox\" disabled> "
                )
                .replace("<div class=\"footnotes\">", "<section class=\"footnotes\">")
                .replaceAll("(?s)(<section class=\"footnotes\">.*)</div>\\n", "$1</section>\n");
    }

    private String renderFrontmatterBlock(String content) {
        String frontmatter = extractYamlFrontmatter(content);
        if (frontmatter.isBlank()) {
            return "";
        }
        return "<pre class=\"frontmatter\"><code>" + escapeHtml(frontmatter) + "</code></pre>\n";
    }

    private String extractYamlFrontmatter(String content) {
        String[] lines = content.split("\n", -1);
        if (lines.length == 0 || !"---".equals(lines[0].trim())) {
            return "";
        }
        StringBuilder frontmatter = new StringBuilder();
        int index = 1;
        while (index < lines.length && !"---".equals(lines[index].trim())) {
            frontmatter.append(lines[index]).append('\n');
            index++;
        }
        return index < lines.length ? frontmatter.toString() : "";
    }

    private String extractExportTitle(String relativePath, String markdown) {
        String content = normalizeLineEndings(markdown);
        String frontmatterTitle = extractFrontmatterTitle(content);
        if (!frontmatterTitle.isBlank()) {
            return frontmatterTitle;
        }
        return FileService.extractTitle(relativePath, stripYamlFrontmatter(content));
    }

    private String extractFrontmatterTitle(String content) {
        List<String> lines = content.lines().toList();
        if (lines.isEmpty() || !"---".equals(lines.get(0).trim())) {
            return "";
        }
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i).trim();
            if ("---".equals(line)) {
                return "";
            }
            int separator = line.indexOf(':');
            if (separator <= 0) {
                continue;
            }
            String key = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            if (!"title".equals(key)) {
                continue;
            }
            return stripYamlQuotes(line.substring(separator + 1).trim());
        }
        return "";
    }

    private String stripYamlFrontmatter(String content) {
        String[] lines = content.split("\n", -1);
        if (lines.length == 0 || !"---".equals(lines[0].trim())) {
            return content;
        }
        int index = 1;
        while (index < lines.length && !"---".equals(lines[index].trim())) {
            index++;
        }
        if (index >= lines.length) {
            return content;
        }
        StringBuilder withoutFrontmatter = new StringBuilder();
        for (int i = index + 1; i < lines.length; i++) {
            withoutFrontmatter.append(lines[i]);
            if (i < lines.length - 1) {
                withoutFrontmatter.append('\n');
            }
        }
        return withoutFrontmatter.toString();
    }

    private String stripYamlQuotes(String value) {
        String trimmed = value == null ? "" : value.trim();
        if ((trimmed.startsWith("\"") && trimmed.endsWith("\""))
                || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.substring(1, trimmed.length() - 1).trim();
        }
        return trimmed;
    }

    private String standaloneHtml(String title, String body) {
        return """
                <!doctype html>
                <html lang="en">
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <title>%s</title>
                  <style>
                    body { margin: 0; padding: 40px; color: #1f2937; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
                    main { max-width: 860px; margin: 0 auto; }
                    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.5em 0 0.6em; }
                    p { margin: 0.8em 0; }
                    table { width: 100%%; border-collapse: collapse; margin: 1em 0; }
                    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
                    th { background: #f3f4f6; }
                    pre { overflow-x: auto; padding: 14px; border-radius: 6px; background: #111827; color: #f9fafb; }
                    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.95em; }
                    p code, li code, td code { padding: 0.1em 0.3em; border-radius: 4px; background: #eef2f7; color: #111827; }
                    .contains-task-list { list-style: none; padding-left: 0; }
                    .task-list-item-checkbox { margin-right: 0.5em; }
                    img { max-width: 100%%; height: auto; }
                    .footnotes, .footnotes-sep { margin-top: 2em; border-top: 1px solid #e5e7eb; font-size: 0.92em; color: #4b5563; }
                    .mermaid { background: #f8fafc; color: #111827; border: 1px solid #e5e7eb; }
                  </style>
                </head>
                <body>
                <main>
                %s
                </main>
                <script>
                  window.__NEXTTYPROA_MERMAID_DONE__ = true;
                </script>
                </body>
                </html>
                """.formatted(
                escapeHtml(title),
                body
        );
    }

    private Path requireVault() {
        Path vaultRoot = workspaceService.getVaultRoot();
        if (vaultRoot == null) {
            throw new BadRequestException("Workspace not configured. Set a vault path first.");
        }
        return vaultRoot;
    }

    private Path resolveSafe(Path vaultRoot, String relativePath) throws IOException {
        try {
            return fileService.resolveSafe(vaultRoot, relativePath);
        } catch (SecurityException e) {
            throw new BadRequestException(e.getMessage());
        }
    }

    private String normalizePath(String path) {
        return FileService.normalizePathSeparators(path);
    }

    private String normalizeLineEndings(String value) {
        return value == null ? "" : value.replace("\r\n", "\n").replace('\r', '\n');
    }

    private String escapeHtml(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
