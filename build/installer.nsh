; NSIS hooks for electron-builder.
;
; The install folder is a DISPLAY name, so it follows the product spelling (V103-12), unlike
; the app identity - appId, app.setName() and therefore %APPDATA%\nexttyproa - which stays
; misspelled on purpose so existing settings keep working. See docs/adr/0002-*.
; It used to read "nextTyproa" here, which is how a 1.0.3 install ended up in a folder the
; product no longer calls itself.
!define INSTALL_SUBFOLDER "nextTypora"

; There is deliberately NO macro here setting the default directory.
;
; This file used to define `customInstallDir`, which looked like it pointed the default at
; "$PROGRAMFILES64\nextTyproa". electron-builder has no such hook - it never inserts a macro by
; that name - so the macro was dead from the day it was written and the default was never
; Program Files. The real default comes from electron-builder's multiUser.nsh: the previous
; InstallLocation if there is one, otherwise the per-user programs folder
; ($LocalAppData\Programs\NextTypora), which needs no elevation. That is what we want, so there
; is nothing to override. Measured, not assumed: a silent install with no /D= lands there.
;
; If a default ever does need overriding, the hook is `preInit`, not `customInstallDir`;
; scripts/verify-dist-resources.js now rejects macro names electron-builder does not insert,
; so a typo cannot go unnoticed the way this one did.

; Whatever directory the user picks, install into a subfolder of it rather than scattering
; ~190 MB of app files directly into it. Only the directory page calls .onVerifyInstDir, so a
; silent install with /D= lands exactly where /D= says.
Function AppendInstallSubFolder
  StrCpy $R0 $INSTDIR "" -1
  StrCmp $R0 "\" 0 +2
    StrCpy $INSTDIR $INSTDIR -1

  StrLen $R1 "${INSTALL_SUBFOLDER}"
  StrLen $R2 $INSTDIR
  IntOp $R3 $R2 - $R1
  IntCmp $R3 0 checkSuffix checkSuffix appendSubFolder

  checkSuffix:
  StrCpy $R4 $INSTDIR $R1 $R3
  StrCmp $R4 "${INSTALL_SUBFOLDER}" done appendSubFolder

  appendSubFolder:
  StrCpy $INSTDIR "$INSTDIR\${INSTALL_SUBFOLDER}"

  done:
  Return
FunctionEnd

Function .onVerifyInstDir
  Call AppendInstallSubFolder
FunctionEnd

; electron-builder records InstallLocation only under its own registry key, so Windows'
; "Installed apps" shows no location for this app and anything reading the standard uninstall
; key cannot find the install folder. Write it where Windows looks.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
!macroend

; unregisterFileAssociations restores the previous default ProgId of .md / .markdown, but
; leaves behind the "<ProgId>_backup" value it created to hold it. Clean our own litter.
; The ProgId below must match build.fileAssociations[].name in package.json;
; scripts/verify-dist-resources.js fails the build if the two drift apart.
!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md" "NextTypora.md_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown" "NextTypora.md_backup"
!macroend
