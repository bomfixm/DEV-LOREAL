# Registra (ou remove, com -Remover) a tarefa do Windows que mantem o banco
# local e a versao de teste (porta 3000) sempre ligados, sem depender do app
# do Claude: inicia ao entrar no Windows, confere a cada 15 minutos (nao
# duplica se ja estiver rodando) e reinicia se o processo terminar com falha.
# O trabalho fica em scripts/manter-servidor.mjs; registro em
# .dados/servidor/servidor.log.
#
# Uso (PowerShell, na pasta praca-reversa):
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tarefa-servidor.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tarefa-servidor.ps1 -Remover
param([switch]$Remover, [int]$Porta = 3000)

$ErrorActionPreference = 'Stop'
$nome = "Praca Reversa - servidor $Porta"
$raiz = Split-Path -Parent $PSScriptRoot

if ($Remover) {
  if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Output "Tarefa '$nome' removida."
  } else {
    Write-Output "Tarefa '$nome' nao existe."
  }
  return
}

$node = (Get-Command node).Source
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$comando = "& '$node' 'scripts\manter-servidor.mjs' '--porta=$Porta'"
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$comando`"" -WorkingDirectory $raiz
$aoEntrar = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$conferir = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger @($aoEntrar, $conferir) -Settings $config -Principal $quem `
  -Description 'Praca Reversa: mantem o banco local e o servidor da versao de teste ligados (scripts/manter-servidor.mjs).' -Force | Out-Null
Start-ScheduledTask -TaskName $nome
Write-Output "Tarefa '$nome' registrada e iniciada (pasta $raiz)."
