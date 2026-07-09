package com.nexttyproa.controller;

import com.nexttyproa.dto.CreateNoteRequest;
import com.nexttyproa.dto.NoteDto;
import com.nexttyproa.dto.SearchResponseDto;
import com.nexttyproa.dto.SearchStatusDto;
import com.nexttyproa.dto.SaveNoteRequest;
import com.nexttyproa.service.IndexService;
import com.nexttyproa.service.NoteService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
@RestController
@RequestMapping("/api")
public class NoteController {

    private final NoteService noteService;
    private final IndexService indexService;

    public NoteController(NoteService noteService, IndexService indexService) {
        this.noteService = noteService;
        this.indexService = indexService;
    }

    @GetMapping("/note")
    public NoteDto getNote(@RequestParam String path) throws IOException {
        return noteService.getNote(path);
    }

    @PutMapping("/note")
    public NoteDto saveNote(@Valid @RequestBody SaveNoteRequest request) throws IOException {
        return noteService.saveNote(request);
    }

    @PostMapping("/note")
    public NoteDto createNote(@Valid @RequestBody CreateNoteRequest request) throws IOException {
        return noteService.createNote(request);
    }

    @DeleteMapping("/note")
    public void deleteNote(@RequestParam String path) throws IOException {
        noteService.deleteNote(path);
    }

    @GetMapping("/search")
    public SearchResponseDto search(@RequestParam(defaultValue = "") String q,
                                    @RequestParam(required = false) String scope,
                                    @RequestParam(required = false) String sort,
                                    @RequestParam(defaultValue = "50") int limit,
                                    @RequestParam(defaultValue = "0") int offset) {
        return indexService.searchPage(q, scope, sort, limit, offset);
    }

    @GetMapping("/search/status")
    public SearchStatusDto searchStatus() {
        return indexService.status();
    }
}
