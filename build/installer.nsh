; ============================================================================
; installer.nsh — NossoSistema NSIS custom installer
;
; O NSIS é o ÚNICO instalador do produto. Ele instala diretamente o aplicativo
; real do sistema em C:\NossoSistema. NÃO existe setup-launcher, NÃO existe
; segundo instalador, NÃO existe autoupdate/embedded — o usuário atualiza
; simplesmente executando uma nova versão deste mesmo instalador.
;
; A elevação para Administrador (UAC) é garantida pelo assisted installer
; (oneClick: false), que gera RequestExecutionLevel admin por padrão — então o
; NSIS já grava em C:\NossoSistema sem depender de elevação via launcher.
; ============================================================================

!macro customHeader
!macroend

!macro customInit
  Push $R0
  !insertmacro GetDParameter $R0
  ${If} $R0 == ""
    StrCpy $INSTDIR "C:\NossoSistema"
  ${EndIf}
  Pop $R0
  CreateDirectory "$INSTDIR"
!macroend

!macro customPageAfterChangeDir
  Var NossoSistema_Tipo
  Var NossoSistema_RadioCli
  Var NossoSistema_RadioSrv

  Page custom fnSelectComponentes fnSelectComponentesLeave

  Function fnSelectComponentes
    StrCpy $NossoSistema_Tipo "servidor"

    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0 0 100% 20u "Selecione os componentes que deseja instalar:"
    Pop $0

    ${NSD_CreateRadioButton} 0 30u 100% 14u "Somente NossoSistema"
    Pop $NossoSistema_RadioCli

    ${NSD_CreateLabel} 20u 44u 80% 14u "Instala apenas o aplicativo/PDV. Conecta a um servidor existente."
    Pop $0

    ${NSD_CreateRadioButton} 0 64u 100% 14u "NossoSistema + Servidor"
    Pop $NossoSistema_RadioSrv

    ${NSD_CreateLabel} 20u 78u 80% 14u "Instala o servidor local, API, banco de dados e aplicativo completo."
    Pop $0

    SendMessage $NossoSistema_RadioSrv ${BM_SETCHECK} ${BST_CHECKED} 0

    nsDialogs::Show
  FunctionEnd

  Function fnSelectComponentesLeave
    ${NSD_GetState} $NossoSistema_RadioCli $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $NossoSistema_Tipo "cliente"
    ${Else}
      StrCpy $NossoSistema_Tipo "servidor"
    ${EndIf}
  FunctionEnd
!macroend

!macro NossoSistema_MatarApp
  nsExec::ExecToLog 'taskkill /F /IM NossoSistema.exe >nul 2>&1'
  nsExec::ExecToLog 'taskkill /F /IM NossoSistema-Servidor.exe >nul 2>&1'
!macroend

!macro customInstall
  DetailPrint "Instalando NossoSistema (instalador único)..."
  DetailPrint "Modo selecionado: $NossoSistema_Tipo"

  ; 0) O modo selecionado no assistente é SEMPRE respeitado. O radio padrão já
  ;    vem em "NossoSistema + Servidor", então reinstalações sem escolha
  ;    explícita mantêm o modo servidor; se o usuário escolher "Somente
  ;    NossoSistema", a instalação passa a ser cliente (Servidor.exe, autostart
  ;    e firewall do servidor são removidos abaixo). Dados do sistema são
  ;    sempre preservados na reinstalação.

  ; 1) Encerra processos instalados (importante em atualização)
  !insertmacro NossoSistema_MatarApp

  ; 2) O pacote instala diretamente o aplicativo real (NossoSistema.exe).
  ;    NÃO há setup-launcher, nem segundo instalador, nem payload embedded.
  ${IfNot} ${FileExists} "$INSTDIR\NossoSistema.exe"
    DetailPrint "ERRO: NossoSistema.exe não encontrado — abortando instalação."
    Abort "Erro: os arquivos do sistema não foram encontrados no instalador."
  ${EndIf}

  ; 2b) Não pode sobrar arquivo com nome antigo do app portable.
  ${If} ${FileExists} "$INSTDIR\Sistema Loja Tabacaria.exe"
    Delete "$INSTDIR\Sistema Loja Tabacaria.exe"
  ${EndIf}

  ; 3) Em modo SERVIDOR, gera o processo servidor a partir do próprio aplicativo
  ;    (o mesmo binário; o modo servidor é detectado pelo nome do executável).
  ;    Isso NÃO duplica o aplicativo no instalador (cópia em tempo de instalação).
  ${If} $NossoSistema_Tipo == "servidor"
    DetailPrint "Instalando servidor local (NossoSistema-Servidor.exe)..."
    CopyFiles /SILENT "$INSTDIR\NossoSistema.exe" "$INSTDIR\NossoSistema-Servidor.exe"
  ${Else}
    Delete "$INSTDIR\NossoSistema-Servidor.exe"
  ${EndIf}

  ; 4) Concede ACL de escrita ao usuário atual. Aplica somente ao usuário logado.
  DetailPrint "Configurando permissões..."
  ReadEnvStr $0 "USERNAME"
  ${If} $0 != ""
    nsExec::ExecToLog 'icacls "$INSTDIR" /grant "$0:(OI)(CI)M" /T /Q'
  ${EndIf}

  ; 5) Grava instalacao.json (tipo + versão)
  FileOpen $0 "$INSTDIR\instalacao.json" w
  FileWrite $0 '{$\"tipo$\":$\"$NossoSistema_Tipo$\",$\"versao$\":$\"${VERSION}$\",$\"instalado_em$\":$\"${__DATE__}$\"}'
  FileClose $0

  ; 6) Registros de desinstalação (chave oficial do produto)
  ${If} $NossoSistema_Tipo == "servidor"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "DisplayName" "NossoSistema (Servidor + Sistema)"
  ${Else}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "DisplayName" "NossoSistema (Somente Sistema)"
  ${EndIf}
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "Publisher" "NossoSistema"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "UninstallString" '"$INSTDIR\NossoSistema.exe" --desinstalar'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "DisplayIcon" "$INSTDIR\NossoSistema.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema" "NoRepair" 1

  ; 7) Servidor: firewall + autostart
  ${If} $NossoSistema_Tipo == "servidor"
    ${If} ${FileExists} "$INSTDIR\NossoSistema-Servidor.exe"
      DetailPrint "Configurando servidor (firewall + autostart)..."
      nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NossoSistema Servidor"'
      nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NossoSistema Servidor" dir=in action=allow program="$INSTDIR\NossoSistema-Servidor.exe" enable=yes'
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NossoSistema Servidor" '"$INSTDIR\NossoSistema-Servidor.exe"'
    ${EndIf}
  ${Else}
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NossoSistema Servidor"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NossoSistema Servidor"
  ${EndIf}

  ; 8) Cria atalhos (Desktop + Menu Iniciar)
  DetailPrint "Criando atalhos..."
  ${If} ${FileExists} "$INSTDIR\NossoSistema.exe"
    CreateDirectory "$DESKTOP"
    CreateShortcut "$DESKTOP\NossoSistema.lnk" "$INSTDIR\NossoSistema.exe" "" "$INSTDIR\resources\sistema.ico"
    CreateDirectory "$SMPROGRAMS\NossoSistema"
    CreateShortcut "$SMPROGRAMS\NossoSistema\NossoSistema.lnk" "$INSTDIR\NossoSistema.exe" "" "$INSTDIR\resources\sistema.ico"
  ${EndIf}

  ${If} $NossoSistema_Tipo == "servidor"
    ${If} ${FileExists} "$INSTDIR\NossoSistema-Servidor.exe"
      CreateShortcut "$DESKTOP\NossoSistema-Servidor.lnk" "$INSTDIR\NossoSistema-Servidor.exe" "" "$INSTDIR\resources\servidor.ico"
      CreateShortcut "$SMPROGRAMS\NossoSistema\NossoSistema-Servidor.lnk" "$INSTDIR\NossoSistema-Servidor.exe" "" "$INSTDIR\resources\servidor.ico"
    ${EndIf}
  ${Else}
    ; Cliente: remove atalhos do servidor que possam ter sobrado de uma
    ; instalação anterior (Servidor.exe já foi removido acima).
    Delete "$DESKTOP\NossoSistema-Servidor.lnk"
    Delete "$SMPROGRAMS\NossoSistema\NossoSistema-Servidor.lnk"
  ${EndIf}

  ; 9) Preserva os dados do usuário (C:\NossoSistema\sistema-loja-tabacaria) — o
  ;    instalador NÃO apaga essa pasta. Dados, banco, configurações e backups
  ;    permanecem intactos na atualização.

  DetailPrint "Instalação concluída. Nenhum instalador adicional será aberto."
!macroend

!macro customUnInstall
  ; Mata os processos antes de apagar — se o app/servidor estiver rodando os
  ; arquivos ficam travados e a desinstalação "não fecha" e "não apaga tudo".
  !insertmacro NossoSistema_MatarApp
  Sleep 2000

  Delete "$DESKTOP\NossoSistema.lnk"
  Delete "$DESKTOP\NossoSistema-Servidor.lnk"
  RMDir /r "$SMPROGRAMS\NossoSistema"

  Delete "$DESKTOP\NossoSistema Servidor.lnk"
  Delete "$DESKTOP\Servidor.lnk"
  Delete "$DESKTOP\Iniciar Servidor.lnk"
  Delete "$DESKTOP\Parar Servidor.lnk"
  Delete "$DESKTOP\Sistema Loja Tabacaria.lnk"
  Delete "$SMPROGRAMS\Sistema Loja Tabacaria.lnk"

  Delete "$INSTDIR\NossoSistema-Servidor.exe"
  Delete "$INSTDIR\Servidor.exe"
  Delete "$INSTDIR\NossoSistema.exe"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NossoSistema Servidor"

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NossoSistema Servidor"'

  IfFileExists "$INSTDIR\sistema-loja-tabacaria\*.*" 0 +3
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Deseja remover tambem os dados do sistema?$\n$\nDados: $INSTDIR\sistema-loja-tabacaria$\n$\n(Banco, configuracoes, logs, backups)" \
      IDYES +2 IDNO +1
    RMDir /r "$INSTDIR\sistema-loja-tabacaria"
!macroend
