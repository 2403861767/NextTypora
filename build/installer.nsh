; NSIS hooks for electron-builder.
; Always install into a "nextTyproa" subfolder under the directory the user picks.

!define NEXTTYPROA_FOLDER "nextTyproa"

!macro customInstallDir
  StrCpy $INSTDIR "$PROGRAMFILES64\${NEXTTYPROA_FOLDER}"
!macroend

Function AppendNextTyproaSubFolder
  StrCpy $R0 $INSTDIR "" -1
  StrCmp $R0 "\" 0 +2
    StrCpy $INSTDIR $INSTDIR -1

  StrLen $R1 "${NEXTTYPROA_FOLDER}"
  StrLen $R2 $INSTDIR
  IntOp $R3 $R2 - $R1
  IntCmp $R3 0 checkSuffix checkSuffix appendSubFolder

  checkSuffix:
  StrCpy $R4 $INSTDIR $R1 $R3
  StrCmp $R4 "${NEXTTYPROA_FOLDER}" done appendSubFolder

  appendSubFolder:
  StrCpy $INSTDIR "$INSTDIR\${NEXTTYPROA_FOLDER}"

  done:
  Return
FunctionEnd

Function .onVerifyInstDir
  Call AppendNextTyproaSubFolder
FunctionEnd
