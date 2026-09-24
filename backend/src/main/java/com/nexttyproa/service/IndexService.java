package com.nexttyproa.service;

import com.nexttyproa.dto.SearchResultDto;
import com.nexttyproa.dto.SearchResponseDto;
import com.nexttyproa.dto.SearchStatusDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

@Service
public class IndexService {

    private static final Logger log = LoggerFactory.getLogger(IndexService.class);
    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 100;
    private static final long MAX_INDEX_BYTES = 2L * 1024L * 1024L;

    private final FileService fileService;
    private final Map<String, IndexedNote> notes = new ConcurrentHashMap<>();
    private volatile boolean indexing;
    private volatile int totalFiles;
    private volatile int failedFiles;
    private volatile int skippedFiles;
    private volatile Instant lastIndexedAt;
    private volatile Path indexedRoot;

    public IndexService(FileService fileService) {
        this.fileService = fileService;
    }

    public void indexNote(Path vaultRoot, String relativePath, String content) {
        try {
            Path file = fileService.resolveSafe(vaultRoot, relativePath);
            long size = Files.exists(file) ? Files.size(file) : -1L;
            if (size > MAX_INDEX_BYTES) {
                notes.remove(FileService.normalizePathSeparators(relativePath));
                skippedFiles++;
                lastIndexedAt = Instant.now();
                return;
            }
            Instant updatedAt = size >= 0
                    ? Files.getLastModifiedTime(file).toInstant()
                    : Instant.now();
            ParsedMarkdown parsed = parseMarkdown(relativePath, content);
            String normalizedPath = FileService.normalizePathSeparators(relativePath);
            String frontmatter = String.join(" ", parsed.frontmatter().keySet()) + " " + String.join(" ", parsed.frontmatter().values());
            // Only lowercased search text is kept; snippets re-read the original file for the returned page.
            notes.put(normalizedPath, new IndexedNote(
                    normalizedPath,
                    parsed.title(),
                    (content == null ? "" : content).toLowerCase(Locale.ROOT),
                    parsed.title().toLowerCase(Locale.ROOT),
                    normalizedPath.toLowerCase(Locale.ROOT),
                    frontmatter.toLowerCase(Locale.ROOT),
                    String.join(" ", parsed.tags()).toLowerCase(Locale.ROOT),
                    updatedAt,
                    size
            ));
            totalFiles = Math.max(totalFiles, notes.size());
            lastIndexedAt = Instant.now();
        } catch (IOException | SecurityException e) {
            failedFiles++;
            log.warn("Failed to index {}: {}", relativePath, e.getMessage());
        }
    }

    public void removeNote(String relativePath) {
        notes.remove(FileService.normalizePathSeparators(relativePath));
        totalFiles = notes.size();
        lastIndexedAt = Instant.now();
    }

    /**
     * Drops every indexed note under the given directory without walking the vault.
     * Synchronized with reindexVault so an in-flight walk cannot re-add entries after they are removed.
     */
    public synchronized void removeNotesUnder(String relativeDirectory) {
        String prefix = FileService.normalizePathSeparators(relativeDirectory) + "/";
        notes.keySet().removeIf(path -> path.startsWith(prefix));
        totalFiles = notes.size();
        lastIndexedAt = Instant.now();
    }

    public void syncRenamedFile(Path vaultRoot, String oldRelativePath, String newRelativePath) throws IOException {
        if (fileService.isMarkdownPath(oldRelativePath)) {
            removeNote(oldRelativePath);
        }
        if (fileService.isMarkdownPath(newRelativePath)) {
            Path file = fileService.resolveSafe(vaultRoot, newRelativePath);
            indexNote(vaultRoot, newRelativePath, fileService.readFile(file));
        }
    }

    /**
     * Incrementally syncs the index with the vault: only files whose size or mtime changed are
     * re-read, entries for files no longer on disk are dropped, and existing entries stay
     * searchable throughout. Switching to a different vault root triggers a full rebuild.
     */
    public synchronized void reindexVault(Path vaultRoot) throws IOException {
        indexing = true;
        if (!Objects.equals(vaultRoot, indexedRoot)) {
            notes.clear();
        }
        indexedRoot = vaultRoot;
        // Entries added concurrently (e.g. by a save) during the walk are not in this snapshot,
        // so they are never treated as stale.
        Set<String> stale = new HashSet<>(notes.keySet());
        AtomicInteger discoveredFiles = new AtomicInteger();
        AtomicInteger failed = new AtomicInteger();
        AtomicInteger skipped = new AtomicInteger();
        try {
            if (vaultRoot == null || !Files.exists(vaultRoot)) {
                notes.clear();
                totalFiles = 0;
                failedFiles = 0;
                skippedFiles = 0;
                lastIndexedAt = Instant.now();
                return;
            }

            try (Stream<Path> walk = Files.walk(vaultRoot)) {
                walk.filter(Files::isRegularFile)
                        .filter(path -> shouldIndex(vaultRoot, path))
                        .forEach(path -> {
                            discoveredFiles.incrementAndGet();
                            String relative = fileService.relativePathString(vaultRoot, path);
                            stale.remove(relative);
                            try {
                                BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
                                if (attrs.size() > MAX_INDEX_BYTES) {
                                    notes.remove(relative);
                                    skipped.incrementAndGet();
                                    return;
                                }
                                IndexedNote existing = notes.get(relative);
                                if (existing != null
                                        && existing.size() == attrs.size()
                                        && existing.updatedAt().equals(attrs.lastModifiedTime().toInstant())) {
                                    return;
                                }
                                indexNote(vaultRoot, relative, fileService.readFile(path));
                            } catch (IOException e) {
                                notes.remove(relative);
                                failed.incrementAndGet();
                                log.warn("Failed to index {}: {}", path, e.getMessage());
                            }
                        });
            }
            stale.forEach(notes::remove);
            totalFiles = discoveredFiles.get();
            failedFiles = failed.get();
            skippedFiles = skipped.get();
            lastIndexedAt = Instant.now();
        } finally {
            indexing = false;
        }
    }

    public List<SearchResultDto> search(String query) {
        return search(query, null, null, DEFAULT_LIMIT, 0);
    }

    public List<SearchResultDto> search(String query, String scope, String sort, int limit, int offset) {
        return searchPage(query, scope, sort, limit, offset).getResults();
    }

    public SearchResponseDto searchPage(String query, String scope, String sort, int limit, int offset) {
        String normalizedQuery = normalizeQuery(query);
        int safeLimit = Math.min(Math.max(limit, 0), MAX_LIMIT);
        int safeOffset = Math.max(offset, 0);
        String responseSort = responseSort(sort);

        if (normalizedQuery.isBlank()) {
            return new SearchResponseDto(List.of(), 0, safeLimit, safeOffset, responseSort);
        }

        Set<SearchScope> scopes = parseScopes(scope);
        List<SearchHit> hits = notes.values().parallelStream()
                .map(note -> match(note, normalizedQuery, scopes))
                .filter(SearchHit::matched)
                .sorted(comparatorFor(sort))
                .toList();
        List<SearchResultDto> results = hits.stream()
                .skip(safeOffset)
                .limit(safeLimit)
                .map(hit -> toResult(hit, normalizedQuery))
                .toList();
        return new SearchResponseDto(results, hits.size(), safeLimit, safeOffset, responseSort);
    }

    public SearchStatusDto status() {
        return new SearchStatusDto(indexing, notes.size(), totalFiles, failedFiles, skippedFiles, lastIndexedAt);
    }

    private boolean shouldIndex(Path vaultRoot, Path path) {
        String relative = fileService.relativePathString(vaultRoot, path);
        if (!fileService.isMarkdownPath(relative)) {
            return false;
        }
        for (Path segment : vaultRoot.relativize(path)) {
            String name = segment.toString();
            if (name.startsWith(".") || name.endsWith(".assets")) {
                return false;
            }
        }
        return true;
    }

    private SearchHit match(IndexedNote note, String query, Set<SearchScope> scopes) {
        int titleIndex = scopes.contains(SearchScope.TITLE) ? note.searchTitle().indexOf(query) : -1;
        int contentIndex = scopes.contains(SearchScope.BODY) ? note.searchBody().indexOf(query) : -1;
        int pathIndex = scopes.contains(SearchScope.PATH) ? note.searchPath().indexOf(query) : -1;
        int frontmatterIndex = scopes.contains(SearchScope.FRONTMATTER) ? note.searchFrontmatter().indexOf(query) : -1;
        int tagsIndex = scopes.contains(SearchScope.TAGS) ? note.searchTags().indexOf(query) : -1;

        double score = 0.0;
        if (titleIndex >= 0) {
            score += 80.0 + startsWithBonus(note.searchTitle(), query);
        }
        if (contentIndex >= 0) {
            score += 25.0 + countOccurrences(note.searchBody(), query) * 8.0;
        }
        if (pathIndex >= 0) {
            score += 45.0;
        }
        if (frontmatterIndex >= 0) {
            score += 55.0;
        }
        if (tagsIndex >= 0) {
            score += 70.0;
        }

        return new SearchHit(note, score > 0.0, contentIndex >= 0, titleIndex, score);
    }

    /**
     * Builds the snippet and line number for one returned hit. Only the requested page reaches here,
     * so the original text is read from disk instead of being held in the index.
     */
    private SearchResultDto toResult(SearchHit hit, String query) {
        IndexedNote note = hit.note();
        String snippet;
        int lineNumber = 1;
        if (!hit.bodyMatched() && hit.titleIndex() >= 0) {
            snippet = snippet(note.title(), hit.titleIndex(), query);
        } else {
            String content = contentForSnippet(note);
            int index = content.toLowerCase(Locale.ROOT).indexOf(query);
            snippet = snippet(content, index, query);
            lineNumber = index >= 0 ? lineNumberForIndex(content, index) : 1;
        }
        return new SearchResultDto(note.path(), note.title(), snippet, lineNumber, hit.score(), note.updatedAt());
    }

    private String contentForSnippet(IndexedNote note) {
        Path root = indexedRoot;
        if (root != null) {
            try {
                return fileService.readFile(fileService.resolveSafe(root, note.path()));
            } catch (IOException | SecurityException e) {
                log.debug("Falling back to indexed text for snippet of {}: {}", note.path(), e.getMessage());
            }
        }
        return note.searchBody();
    }

    private String snippet(String content, int index, String query) {
        if (content == null || content.isBlank()) {
            return "";
        }
        if (index < 0) {
            return escapeHtml(firstLine(content));
        }
        int start = Math.max(0, index - 60);
        int matchEnd = Math.min(content.length(), index + query.length());
        int end = Math.min(content.length(), matchEnd + 90);
        String prefix = start > 0 ? "..." : "";
        String suffix = end < content.length() ? "..." : "";
        String before = content.substring(start, index);
        String match = content.substring(index, matchEnd);
        String after = content.substring(matchEnd, end);
        return prefix
                + normalizeSnippetWhitespace(escapeHtml(before))
                + "<mark>" + escapeHtml(match) + "</mark>"
                + normalizeSnippetWhitespace(escapeHtml(after))
                + suffix;
    }

    private String firstLine(String content) {
        return content.lines()
                .map(String::trim)
                .filter(line -> !line.isEmpty())
                .findFirst()
                .orElse("");
    }

    private String normalizeQuery(String query) {
        return query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
    }

    private Set<SearchScope> parseScopes(String scope) {
        if (scope == null || scope.isBlank() || "all".equalsIgnoreCase(scope.trim())) {
            return EnumSet.allOf(SearchScope.class);
        }

        EnumSet<SearchScope> scopes = EnumSet.noneOf(SearchScope.class);
        for (String value : scope.split(",")) {
            switch (value.trim().toLowerCase(Locale.ROOT)) {
                case "title" -> scopes.add(SearchScope.TITLE);
                case "body", "content" -> scopes.add(SearchScope.BODY);
                case "path" -> scopes.add(SearchScope.PATH);
                case "tag", "tags" -> scopes.add(SearchScope.TAGS);
                case "frontmatter", "metadata" -> scopes.add(SearchScope.FRONTMATTER);
                default -> {
                }
            }
        }
        return scopes.isEmpty() ? EnumSet.allOf(SearchScope.class) : scopes;
    }

    private Comparator<SearchHit> comparatorFor(String sort) {
        String normalizedSort = sort == null ? "relevance" : sort.trim().toLowerCase(Locale.ROOT);
        Comparator<SearchHit> relevance = Comparator
                .comparingDouble(SearchHit::score).reversed()
                .thenComparing(SearchHit::updatedAt, Comparator.reverseOrder())
                .thenComparing(hit -> hit.note().path());
        if ("updated".equals(normalizedSort) || "updatedat".equals(normalizedSort) || "updated_at".equals(normalizedSort)) {
            return Comparator
                    .comparing(SearchHit::updatedAt, Comparator.reverseOrder())
                    .thenComparing(Comparator.comparingDouble(SearchHit::score).reversed())
                    .thenComparing(hit -> hit.note().path());
        }
        if ("path".equals(normalizedSort)) {
            return Comparator
                    .comparing((SearchHit hit) -> hit.note().path())
                    .thenComparing(Comparator.comparingDouble(SearchHit::score).reversed())
                    .thenComparing(SearchHit::updatedAt, Comparator.reverseOrder());
        }
        return relevance;
    }

    private String responseSort(String sort) {
        String normalizedSort = sort == null ? "relevance" : sort.trim().toLowerCase(Locale.ROOT);
        if ("updated".equals(normalizedSort) || "updatedat".equals(normalizedSort) || "updated_at".equals(normalizedSort)) {
            return "updatedAt";
        }
        if ("path".equals(normalizedSort)) {
            return "path";
        }
        return "relevance";
    }

    private ParsedMarkdown parseMarkdown(String relativePath, String content) {
        Map<String, String> frontmatter = extractFrontmatter(content);
        Set<String> tags = extractTags(content, frontmatter);
        String title = frontmatter.getOrDefault("title", FileService.extractTitle(relativePath, content));
        return new ParsedMarkdown(title, frontmatter, tags);
    }

    private Map<String, String> extractFrontmatter(String content) {
        Map<String, String> frontmatter = new HashMap<>();
        if (content == null || !content.startsWith("---")) {
            return frontmatter;
        }
        List<String> lines = content.lines().toList();
        if (lines.isEmpty() || !"---".equals(lines.get(0).trim())) {
            return frontmatter;
        }
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i).trim();
            if ("---".equals(line)) {
                return frontmatter;
            }
            int separator = line.indexOf(':');
            if (separator <= 0) {
                continue;
            }
            String key = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(separator + 1).trim();
            if (!key.isEmpty() && !value.isEmpty()) {
                frontmatter.put(key, stripYamlQuotes(value));
            }
        }
        return frontmatter;
    }

    private Set<String> extractTags(String content, Map<String, String> frontmatter) {
        Set<String> tags = new LinkedHashSet<>();
        String frontmatterTags = frontmatter.get("tags");
        if (frontmatterTags != null) {
            String cleanTags = frontmatterTags.replace("[", "").replace("]", "");
            Arrays.stream(cleanTags.split(","))
                    .map(this::stripYamlQuotes)
                    .map(String::trim)
                    .filter(tag -> !tag.isEmpty())
                    .map(tag -> tag.startsWith("#") ? tag.substring(1) : tag)
                    .forEach(tags::add);
        }
        if (content != null) {
            for (String token : content.split("\\s+")) {
                if (token.startsWith("#") && token.length() > 1) {
                    String tag = token.substring(1).replaceAll("[^\\p{Alnum}_-]", "");
                    if (!tag.isBlank()) {
                        tags.add(tag);
                    }
                }
            }
        }
        return tags;
    }

    private String stripYamlQuotes(String value) {
        String trimmed = value == null ? "" : value.trim();
        if ((trimmed.startsWith("\"") && trimmed.endsWith("\""))
                || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }

    private double startsWithBonus(String value, String query) {
        return value.startsWith(query) ? 15.0 : 0.0;
    }

    private int countOccurrences(String value, String query) {
        if (query.isEmpty()) {
            return 0;
        }
        int count = 0;
        int index = value.indexOf(query);
        while (index >= 0) {
            count++;
            index = value.indexOf(query, index + query.length());
        }
        return count;
    }

    private int lineNumberForIndex(String content, int index) {
        if (content == null || index <= 0) {
            return 1;
        }
        int line = 1;
        for (int i = 0; i < Math.min(index, content.length()); i++) {
            if (content.charAt(i) == '\n') {
                line++;
            }
        }
        return line;
    }

    private String normalizeSnippetWhitespace(String value) {
        return value.replaceAll("\\s+", " ");
    }

    private String escapeHtml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;");
    }

    private enum SearchScope {
        TITLE,
        BODY,
        PATH,
        TAGS,
        FRONTMATTER
    }

    private record IndexedNote(
            String path,
            String title,
            String searchBody,
            String searchTitle,
            String searchPath,
            String searchFrontmatter,
            String searchTags,
            Instant updatedAt,
            long size
    ) {
    }

    private record SearchHit(IndexedNote note, boolean matched, boolean bodyMatched, int titleIndex, double score) {
        Instant updatedAt() {
            return note.updatedAt();
        }
    }

    private record ParsedMarkdown(String title, Map<String, String> frontmatter, Set<String> tags) {
    }
}
