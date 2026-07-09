package com.nexttyproa.controller;

import com.nexttyproa.service.AssetService;
import com.nexttyproa.service.FileSystemService;
import com.nexttyproa.service.NoteService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.nio.charset.IllegalCharsetNameException;
import java.nio.charset.UnsupportedCharsetException;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(NoteService.NotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(NoteService.NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(NoteService.ConflictException.class)
    public ResponseEntity<Map<String, String>> handleConflict(NoteService.ConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(NoteService.NoteConflictException.class)
    public ResponseEntity<Map<String, String>> handleNoteConflict(NoteService.NoteConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                "code", "NOTE_CONFLICT",
                "error", ex.getMessage(),
                "path", ex.getPath(),
                "currentHash", ex.getCurrentHash(),
                "currentUpdatedAt", ex.getCurrentUpdatedAt().toString()
        ));
    }

    @ExceptionHandler(NoteService.BadRequestException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(NoteService.BadRequestException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(AssetService.NotFoundException.class)
    public ResponseEntity<Map<String, String>> handleAssetNotFound(AssetService.NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(AssetService.BadRequestException.class)
    public ResponseEntity<Map<String, String>> handleAssetBadRequest(AssetService.BadRequestException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(FileSystemService.NotFoundException.class)
    public ResponseEntity<Map<String, String>> handleFileSystemNotFound(FileSystemService.NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(FileSystemService.ConflictException.class)
    public ResponseEntity<Map<String, String>> handleFileSystemConflict(FileSystemService.ConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(FileSystemService.BadRequestException.class)
    public ResponseEntity<Map<String, String>> handleFileSystemBadRequest(FileSystemService.BadRequestException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> handleSecurity(SecurityException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler({IllegalCharsetNameException.class, UnsupportedCharsetException.class})
    public ResponseEntity<Map<String, String>> handleInvalidCharset(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "Unsupported encoding: " + ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(err -> err.getField() + ": " + err.getDefaultMessage())
                .orElse("Validation failed");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", message));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGeneric(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", ex.getMessage() != null ? ex.getMessage() : "Internal error"));
    }
}
