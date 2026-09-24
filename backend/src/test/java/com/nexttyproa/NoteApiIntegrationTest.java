package com.nexttyproa;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nexttyproa.dto.CreateFolderRequest;
import com.nexttyproa.dto.CreateNoteRequest;
import com.nexttyproa.dto.RenamePathRequest;
import com.nexttyproa.dto.SaveNoteRequest;
import com.nexttyproa.dto.WorkspaceRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class NoteApiIntegrationTest {

    private static final String TOKEN = "test-token";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private Path tempVault;

    @BeforeEach
    void setUp() throws Exception {
        tempVault = Files.createTempDirectory("nexttyproa-test-vault");
    }

    @Test
    void healthEndpointIsPublic() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void unauthorizedWithoutToken() throws Exception {
        mockMvc.perform(get("/api/workspace"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void wrongTokenIsRejected() throws Exception {
        mockMvc.perform(get("/api/workspace")
                        .header("X-Auth-Token", "wrong-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"));
    }

    @Test
    void corsPreflightOnProtectedEndpointBypassesAuth() throws Exception {
        mockMvc.perform(options("/api/workspace")
                        .header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
                .andExpect(header().string("Access-Control-Allow-Methods", containsString("GET")));
    }

    private void configureWorkspace() throws Exception {
        WorkspaceRequest workspaceRequest = new WorkspaceRequest();
        workspaceRequest.setPath(tempVault.toString());

        mockMvc.perform(post("/api/workspace")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(workspaceRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value(tempVault.toString()));
    }

    @Test
    void unicodeNotePathNameAndSearchAreSupported() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("项目/会议记录-你好.md");
        createRequest.setContent("# 会议记录\n\n这里包含 unicode-search-关键字 和中文内容。");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("项目/会议记录-你好.md"))
                .andExpect(jsonPath("$.title").value("会议记录"));

        mockMvc.perform(get("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "项目/会议记录-你好.md"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", containsString("中文内容")));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "关键字"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.results[0].path").value("项目/会议记录-你好.md"));
    }

    @Test
    void unicodeNotePathWithSpecialCharactersIsSupported() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("notes/中文 space-!@.md");
        createRequest.setContent("# 中文 Title\nSymbols !@#$%^&*()");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("notes/中文 space-!@.md"))
                .andExpect(jsonPath("$.title").value("中文 Title"));
    }

    @Test
    void invalidSaveEncodingReturnsBadRequest() throws Exception {
        configureWorkspace();

        SaveNoteRequest saveRequest = new SaveNoteRequest();
        saveRequest.setPath("charset.md");
        saveRequest.setContent("x");
        saveRequest.setEncoding("NO_SUCH_CHARSET");

        mockMvc.perform(put("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(saveRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("Unsupported encoding")));
    }

    @Test
    void duplicateNoteCreateIsRejected() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("duplicate.md");
        createRequest.setContent("# Duplicate");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error", containsString("Note already exists")));
    }

    @Test
    void renameCollisionIsRejected() throws Exception {
        configureWorkspace();
        Files.createDirectories(tempVault.resolve("docs"));
        Files.writeString(tempVault.resolve("docs/source.md"), "# Source");
        Files.writeString(tempVault.resolve("docs/existing.md"), "# Existing");

        RenamePathRequest renameRequest = new RenamePathRequest();
        renameRequest.setPath("docs/source.md");
        renameRequest.setNewName("existing.md");

        mockMvc.perform(put("/api/files/rename")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(renameRequest)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error", containsString("Path already exists")));
    }

    @Test
    @EnabledOnOs(OS.WINDOWS)
    void renameToWindowsInvalidNameIsRejected() throws Exception {
        configureWorkspace();
        Files.writeString(tempVault.resolve("source.md"), "# Source");

        RenamePathRequest renameRequest = new RenamePathRequest();
        renameRequest.setPath("source.md");
        renameRequest.setNewName("test<>file.md");

        mockMvc.perform(put("/api/files/rename")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(renameRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("not allowed on Windows")));
    }

    @Test
    @EnabledOnOs(OS.WINDOWS)
    void createWithWindowsReservedNameIsRejected() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("docs/CON.md");
        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("reserved on Windows")));

        CreateFolderRequest folderRequest = new CreateFolderRequest();
        folderRequest.setPath("what?/inner");
        mockMvc.perform(post("/api/files/folder")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(folderRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("not allowed on Windows")));
    }

    @Test
    void fileOperationsAreWrittenToTheAuditLog(CapturedOutput output) throws Exception {
        configureWorkspace();
        Files.writeString(tempVault.resolve("old.md"), "# Old");

        RenamePathRequest renameRequest = new RenamePathRequest();
        renameRequest.setPath("old.md");
        renameRequest.setNewName("new.md");
        mockMvc.perform(put("/api/files/rename")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(renameRequest)))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/api/files")
                        .param("path", "new.md")
                        .header("X-Auth-Token", TOKEN))
                .andExpect(status().isOk());

        assertThat(output.getOut()).contains("Renamed file: old.md -> new.md", "Deleted file: new.md");
    }

    @Test
    void deleteNonExistentNoteReturnsNotFound() throws Exception {
        configureWorkspace();

        mockMvc.perform(delete("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "missing.md"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error", containsString("Note not found")));
    }

    @Test
    void invalidPaginationValuesAreNormalized() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("pagination.md");
        createRequest.setContent("# Pagination\n\npagination-keyword");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "pagination-keyword")
                        .param("limit", "-5")
                        .param("offset", "-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.limit").value(0))
                .andExpect(jsonPath("$.offset").value(0));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "pagination-keyword")
                        .param("limit", "999")
                        .param("offset", "0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.limit").value(100))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void emptyExportStillReturnsHtmlDocument() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("empty.md");
        createRequest.setContent("");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/export/html")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("path", "empty.md"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("empty.md"))
                .andExpect(jsonPath("$.title").value("empty"))
                .andExpect(jsonPath("$.html", containsString("<!doctype html>")));
    }

    @Test
    void assetDownloadRequiresAuthorizationAndRejectsUnsafePath() throws Exception {
        configureWorkspace();
        Files.createDirectories(tempVault.resolve("note.assets"));
        byte[] pngBytes = new byte[] {
                (byte) 0x89, 0x50, 0x4e, 0x47,
                0x0d, 0x0a, 0x1a, 0x0a
        };
        Files.write(tempVault.resolve("note.assets/image.png"), pngBytes);

        mockMvc.perform(get("/api/asset")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "note.assets/image.png"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "private, max-age=3600"))
                .andExpect(content().bytes(pngBytes));

        mockMvc.perform(get("/api/asset")
                        .header("X-Auth-Token", "wrong-token")
                        .param("path", "note.assets/image.png"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"));

        mockMvc.perform(get("/api/asset")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "../outside.png"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("Path traversal detected")));
    }

    @Test
    void fullNoteWorkflow() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("hello.md");
        createRequest.setContent("# Hello World\n\nThis is a **test** note about springboot.");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("hello.md"))
                .andExpect(jsonPath("$.title").value("Hello World"));

        String getBody = mockMvc.perform(get("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "hello.md"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", containsString("springboot")))
                .andReturn()
                .getResponse()
                .getContentAsString();

        String baseHash = objectMapper.readTree(getBody).get("contentHash").asText();

        SaveNoteRequest saveRequest = new SaveNoteRequest();
        saveRequest.setPath("hello.md");
        saveRequest.setContent("# Hello World\n\nUpdated content with springboot keyword.");
        saveRequest.setBaseHash(baseHash);

        mockMvc.perform(put("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(saveRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/tree")
                        .header("X-Auth-Token", TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "springboot"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1));

        mockMvc.perform(delete("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "hello.md"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "hello.md"))
                .andExpect(status().isNotFound());
    }

    @Test
    void saveDetectsExternalModificationAndAllowsForceOverwrite() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("conflict.md");
        createRequest.setContent("# Conflict\n\noriginal");

        String createBody = mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contentHash").exists())
                .andReturn()
                .getResponse()
                .getContentAsString();

        String baseHash = objectMapper.readTree(createBody).get("contentHash").asText();
        Files.writeString(tempVault.resolve("conflict.md"), "# Conflict\n\nexternal");

        SaveNoteRequest staleSave = new SaveNoteRequest();
        staleSave.setPath("conflict.md");
        staleSave.setContent("# Conflict\n\nnext");
        staleSave.setBaseHash(baseHash);

        mockMvc.perform(put("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(staleSave)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOTE_CONFLICT"))
                .andExpect(jsonPath("$.currentHash").exists());

        staleSave.setForce(true);

        mockMvc.perform(put("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(staleSave)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("# Conflict\n\nnext"));
    }

    @Test
    void markdownExtensionIsSupportedEverywhere() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("longform.markdown");
        createRequest.setContent("# Longform\n\nmarkdown-extension-keyword");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("longform.markdown"))
                .andExpect(jsonPath("$.title").value("Longform"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "markdown-extension-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.results[0].path").value("longform.markdown"));
    }

    @Test
    void searchIndexesMetadataScopesSortsPaginatesAndReportsStatus() throws Exception {
        configureWorkspace();
        Files.createDirectories(tempVault.resolve("projects"));

        Path alpha = tempVault.resolve("projects/alpha.md");
        Files.writeString(alpha, """
                ---
                title: Roadmap Alpha
                tags: [search, product]
                owner: backend-platform
                ---
                # Roadmap Alpha

                Body mentions rocket-query and a literal ++special++ token.
                """);

        Path beta = tempVault.resolve("projects/beta.md");
        Files.writeString(beta, """
                # Beta

                rocket-query appears twice for relevance.
                Another rocket-query line.
                """);

        Path pathOnly = tempVault.resolve("zzz-path-hit.md");
        Files.writeString(pathOnly, "# Path Only\n\nNo shared search phrase.");

        Files.setLastModifiedTime(alpha, FileTime.from(Instant.parse("2024-01-01T00:00:00Z")));
        Files.setLastModifiedTime(beta, FileTime.from(Instant.parse("2024-02-01T00:00:00Z")));
        Files.setLastModifiedTime(pathOnly, FileTime.from(Instant.parse("2024-03-01T00:00:00Z")));

        mockMvc.perform(post("/api/tree/refresh")
                        .header("X-Auth-Token", TOKEN))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/search/status")
                        .header("X-Auth-Token", TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.indexing").value(false))
                .andExpect(jsonPath("$.indexedFiles").value(3))
                .andExpect(jsonPath("$.totalFiles").value(3))
                .andExpect(jsonPath("$.lastIndexedAt").exists());

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "Roadmap Alpha")
                        .param("scope", "title"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.limit").value(50))
                .andExpect(jsonPath("$.offset").value(0))
                .andExpect(jsonPath("$.sort").value("relevance"))
                .andExpect(jsonPath("$.results[0].path").value("projects/alpha.md"))
                .andExpect(jsonPath("$.results[0].title").value("Roadmap Alpha"))
                .andExpect(jsonPath("$.results[0].lineNumber").value(1))
                .andExpect(jsonPath("$.results[0].score", greaterThan(0.0)));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "backend-platform")
                        .param("scope", "frontmatter"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.results[0].path").value("projects/alpha.md"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "product")
                        .param("scope", "tags"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.results[0].path").value("projects/alpha.md"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "zzz-path-hit")
                        .param("scope", "path"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.results[0].path").value("zzz-path-hit.md"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "++special++"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.results[0].snippet", containsString("<mark>++special++</mark>")))
                .andExpect(jsonPath("$.results[0].lineNumber", greaterThan(1)));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "rocket-query")
                        .param("sort", "updated"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(2)))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.sort").value("updatedAt"))
                .andExpect(jsonPath("$.results[0].path").value("projects/beta.md"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "rocket-query")
                        .param("sort", "path")
                        .param("limit", "1")
                        .param("offset", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.limit").value(1))
                .andExpect(jsonPath("$.offset").value(1))
                .andExpect(jsonPath("$.sort").value("path"))
                .andExpect(jsonPath("$.results[0].path").value("projects/beta.md"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", ""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void filesystemOperationsManageVisibleFilesAndIndexes() throws Exception {
        configureWorkspace();
        Files.writeString(tempVault.resolve("readme.txt"), "visible text");
        Files.createDirectories(tempVault.resolve("hidden.assets"));
        Files.createDirectories(tempVault.resolve(".hidden"));

        mockMvc.perform(get("/api/tree")
                        .header("X-Auth-Token", TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("readme.txt"))
                .andExpect(jsonPath("$[0].directory").value(false))
                .andExpect(jsonPath("$", hasSize(1)));

        CreateFolderRequest folderRequest = new CreateFolderRequest();
        folderRequest.setPath("docs/nested");

        mockMvc.perform(post("/api/files/folder")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(folderRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("nested"))
                .andExpect(jsonPath("$.path").value("docs/nested"))
                .andExpect(jsonPath("$.directory").value(true));

        mockMvc.perform(delete("/api/files")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "readme.txt"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("readme.txt"))
                .andExpect(jsonPath("$.directory").value(false));

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("docs/nested/searchable.md");
        createRequest.setContent("# Searchable\n\nalpha-keyword");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk());

        RenamePathRequest renameFileRequest = new RenamePathRequest();
        renameFileRequest.setPath("docs/nested/searchable.md");
        renameFileRequest.setNewName("renamed.txt");

        mockMvc.perform(put("/api/files/rename")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(renameFileRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("docs/nested/renamed.txt"))
                .andExpect(jsonPath("$.directory").value(false));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "alpha-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.total").value(0));

        RenamePathRequest renameBackRequest = new RenamePathRequest();
        renameBackRequest.setPath("docs/nested/renamed.txt");
        renameBackRequest.setNewName("searchable.md");

        mockMvc.perform(put("/api/files/rename")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(renameBackRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("docs/nested/searchable.md"));

        RenamePathRequest renameFolderRequest = new RenamePathRequest();
        renameFolderRequest.setPath("docs/nested");
        renameFolderRequest.setNewName("renamed-folder");

        mockMvc.perform(put("/api/files/rename")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(renameFolderRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("docs/renamed-folder"))
                .andExpect(jsonPath("$.directory").value(true));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "alpha-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.results[0].path").value("docs/renamed-folder/searchable.md"));

        CreateFolderRequest conflictRequest = new CreateFolderRequest();
        conflictRequest.setPath("docs/renamed-folder");

        mockMvc.perform(post("/api/files/folder")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(conflictRequest)))
                .andExpect(status().isConflict());

        mockMvc.perform(delete("/api/files")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "../outside.txt"))
                .andExpect(status().isBadRequest());

        CreateNoteRequest textNoteRequest = new CreateNoteRequest();
        textNoteRequest.setPath("plain.txt");
        textNoteRequest.setContent("not markdown");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(textNoteRequest)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "docs/renamed-folder/searchable.txt"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(delete("/api/files")
                        .header("X-Auth-Token", TOKEN)
                        .param("path", "docs/renamed-folder"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.directory").value(true));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "alpha-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void movePathValidatesTargetsAndUpdatesIndex() throws Exception {
        configureWorkspace();
        Files.createDirectories(tempVault.resolve("docs/nested"));
        Files.createDirectories(tempVault.resolve("archive"));

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("docs/nested/searchable.md");
        createRequest.setContent("# Searchable\n\nmove-keyword");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "docs/nested/searchable.md",
                                "targetFolder", "archive"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("searchable.md"))
                .andExpect(jsonPath("$.path").value("archive/searchable.md"))
                .andExpect(jsonPath("$.directory").value(false));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "move-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.results[0].path").value("archive/searchable.md"));

        Files.writeString(tempVault.resolve("docs/conflict.md"), "# Conflict");
        Files.writeString(tempVault.resolve("archive/conflict.md"), "# Existing");

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "docs/conflict.md",
                                "targetFolder", "archive"
                        ))))
                .andExpect(status().isConflict());

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "docs/conflict.md",
                                "targetFolder", "docs"
                        ))))
                .andExpect(status().isBadRequest());

        Files.createDirectories(tempVault.resolve("parent/child"));

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "parent",
                                "targetFolder", "parent/child"
                        ))))
                .andExpect(status().isBadRequest());

        CreateNoteRequest directoryNote = new CreateNoteRequest();
        directoryNote.setPath("parent/child/nested.markdown");
        directoryNote.setContent("# Nested\n\ndirectory-move-keyword");

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(directoryNote)))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "parent",
                                "targetFolder", "archive"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("archive/parent"))
                .andExpect(jsonPath("$.directory").value(true));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "directory-move-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.results[0].path").value("archive/parent/child/nested.markdown"));

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "",
                                "targetFolder", "archive"
                        ))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(put("/api/files/move")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "path", "../outside.md",
                                "targetFolder", "archive"
                        ))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void exportHtmlRendersAdvancedMarkdownAndRejectsUnsafePaths() throws Exception {
        configureWorkspace();

        CreateNoteRequest createRequest = new CreateNoteRequest();
        createRequest.setPath("exports/report.md");
        createRequest.setContent("""
                ---
                title: Export Title
                ---
                # Export Title

                A paragraph with **bold** text, an image ![Alt](./img.png), and a note[^1].

                | Name | Value |
                | --- | --- |
                | Alpha | 1 |

                - [x] Done
                - [ ] Todo

                ```java
                System.out.println("hello");
                ```

                ```mermaid
                graph TD
                  A-->B
                ```

                [^1]: Footnote text
                """);

        mockMvc.perform(post("/api/note")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/export/html")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("path", "exports/report.md"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value("exports/report.md"))
                .andExpect(jsonPath("$.title").value("Export Title"))
                .andExpect(jsonPath("$.html", containsString("<!doctype html>")))
                .andExpect(jsonPath("$.html", containsString("<pre class=\"frontmatter\"><code>title: Export Title")))
                .andExpect(jsonPath("$.html", containsString("<h1>Export Title</h1>")))
                .andExpect(jsonPath("$.html", containsString("<strong>bold</strong>")))
                .andExpect(jsonPath("$.html", containsString("<img src=\"./img.png\" alt=\"Alt\">")))
                .andExpect(jsonPath("$.html", containsString("<table>")))
                .andExpect(jsonPath("$.html", containsString("<input type=\"checkbox\" disabled checked>")))
                .andExpect(jsonPath("$.html", containsString("<code class=\"language-java\">")))
                .andExpect(jsonPath("$.html", containsString("<pre class=\"mermaid\">graph TD")))
                .andExpect(jsonPath("$.html", containsString("<section class=\"footnotes\">")));

        mockMvc.perform(post("/api/export/html")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("path", "../outside.md"))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/export/html")
                        .header("X-Auth-Token", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("path", "missing.md"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void refreshTreeReindexesVaultAndReturnsCurrentTree() throws Exception {
        configureWorkspace();
        Files.writeString(tempVault.resolve("external.md"), "# External\n\nrefresh-keyword");

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "refresh-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.total").value(0));

        mockMvc.perform(post("/api/tree/refresh")
                        .header("X-Auth-Token", TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].path").value("external.md"));

        mockMvc.perform(get("/api/search")
                        .header("X-Auth-Token", TOKEN)
                        .param("q", "refresh-keyword"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.results[0].path").value("external.md"));
    }
}
