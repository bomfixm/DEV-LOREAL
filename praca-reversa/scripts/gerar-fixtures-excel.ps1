# Gera, com o Microsoft Excel instalado (automação COM), as planilhas de teste
# da importação em apps/api/test/fixtures/excel/. Dados fictícios. Só é preciso
# rodar de novo para recriar os arquivos; os testes usam os arquivos gerados.
#
#   powershell -ExecutionPolicy Bypass -File scripts/gerar-fixtures-excel.ps1
#
# Cobre: várias abas, células formatadas como Texto com zeros à esquerda,
# identificadores digitados como número (zeros perdidos), número longo que o
# Excel grava em notação científica, fórmula, data, decimais, e os formatos
# Strict Open XML, CSV UTF-8 e CSV do Excel (Windows-1252).
$ErrorActionPreference = 'Stop'
$destino = Join-Path $PSScriptRoot '..\apps\api\test\fixtures\excel'
New-Item -ItemType Directory -Force $destino | Out-Null
$destino = (Resolve-Path $destino).Path

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
function Texto($celula, [string]$valor) { $celula.NumberFormat = '@'; $celula.Value2 = $valor }
$serial = ([datetime]'2026-09-15' - [datetime]'1899-12-30').Days

try {
  # 1. Devoluções com várias abas; a primeira é de instruções.
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 3) { $wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) | Out-Null }
  $inst = $wb.Worksheets.Item(1); $inst.Name = 'Instruções'
  Texto $inst.Range('A1') 'Planilha fictícia de teste (não é dado da operação).'
  $ws = $wb.Worksheets.Item(2); $ws.Name = 'Devoluções'
  $titulos = 'Referência da devolução', 'Linha', 'SKU', 'Quantidade declarada', 'Unidade', 'NF', 'Lote', 'Data do documento'
  for ($i = 0; $i -lt $titulos.Count; $i++) { Texto $ws.Cells.Item(1, $i + 1) $titulos[$i] }
  # Linha 2: tudo certo (identificadores como Texto, linha numérica, data de verdade).
  Texto $ws.Range('A2') 'DEV-XL-0001'; $ws.Range('B2').Value2 = 1; Texto $ws.Range('C2') '000123'; $ws.Range('D2').Value2 = 100
  Texto $ws.Range('E2') 'UN'; Texto $ws.Range('F2') '000045678'; Texto $ws.Range('G2') '0042'
  $ws.Range('H2').Value2 = $serial; $ws.Range('H2').NumberFormat = 'dd/mm/yyyy'
  # Linha 3: caixa, lote vazio (pendente), data em texto.
  Texto $ws.Range('A3') 'DEV-XL-0001'; Texto $ws.Range('B3') '2'; Texto $ws.Range('C3') '000123'; $ws.Range('D3').Value2 = 2
  Texto $ws.Range('E3') 'CX'; Texto $ws.Range('F3') '000045678'; Texto $ws.Range('H3') '15/09/2026'
  # Linha 4: SKU digitado como número (zeros à esquerda perdidos).
  Texto $ws.Range('A4') 'DEV-XL-0002'; $ws.Range('B4').Value2 = 1; $ws.Range('C4').Value2 = 123; $ws.Range('D4').Value2 = 5; Texto $ws.Range('E4') 'UN'
  # Linha 5: NF digitada como número.
  Texto $ws.Range('A5') 'DEV-XL-0002'; $ws.Range('B5').Value2 = 2; Texto $ws.Range('C5') '000123'; $ws.Range('D5').Value2 = 5; Texto $ws.Range('E5') 'UN'; $ws.Range('F5').Value2 = 45678
  # Linha 6: quantidade por fórmula.
  Texto $ws.Range('A6') 'DEV-XL-0002'; $ws.Range('B6').Value2 = 3; Texto $ws.Range('C6') '000123'; $ws.Range('D6').Formula = '=50*2'; Texto $ws.Range('E6') 'UN'
  # Linha 7: código longo digitado como número (o Excel guarda só 15 dígitos significativos).
  Texto $ws.Range('A7') 'DEV-XL-0002'; $ws.Range('B7').Value2 = 4; $ws.Range('C7').Value2 = [double]7891234567890123; $ws.Range('D7').Value2 = 1; Texto $ws.Range('E7') 'UN'
  # Linha 8: quantidade com 4 casas decimais.
  Texto $ws.Range('A8') 'DEV-XL-0002'; $ws.Range('B8').Value2 = 5; Texto $ws.Range('C8') 'MODELO-KG'; $ws.Range('D8').Value2 = 1.2345; Texto $ws.Range('E8') 'KG'
  # Linha 9: quantidade decimal válida (KG).
  Texto $ws.Range('A9') 'DEV-XL-0002'; $ws.Range('B9').Value2 = 6; Texto $ws.Range('C9') 'MODELO-KG'; $ws.Range('D9').Value2 = 1.5; Texto $ws.Range('E9') 'KG'
  $outra = $wb.Worksheets.Item(3); $outra.Name = 'Resumo'
  Texto $outra.Range('A1') 'Total'; $outra.Range('B1').Formula = "=SUM('Devoluções'!D2:D9)"
  $wb.SaveAs((Join-Path $destino 'devolucoes-varias-abas.xlsx'), 51)
  # Mesmo conteúdo em Strict Open XML.
  $wb.SaveAs((Join-Path $destino 'devolucoes-strict.xlsx'), 61)
  $wb.Close($false)

  # 2. Produtos (uma aba) e as duas versões em CSV salvas pelo Excel.
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Produtos'
  $titulos = 'SKU', 'Descrição', 'Unidade canônica', 'Código de barras', 'Embalagem do código', 'Fator'
  for ($i = 0; $i -lt $titulos.Count; $i++) { Texto $ws.Cells.Item(1, $i + 1) $titulos[$i] }
  Texto $ws.Range('A2') '000123'; Texto $ws.Range('B2') 'Xampu fictício "suave" 300 ml'; Texto $ws.Range('C2') 'UN'; Texto $ws.Range('D2') '0200000123001'; Texto $ws.Range('E2') 'UN'; $ws.Range('F2').Value2 = 1
  Texto $ws.Range('A3') '000123'; Texto $ws.Range('B3') 'Xampu fictício "suave" 300 ml'; Texto $ws.Range('C3') 'UN'; Texto $ws.Range('D3') '10200000123008'; Texto $ws.Range('E3') 'CX'; $ws.Range('F3').Value2 = 12
  Texto $ws.Range('A4') 'MODELO-KG'; Texto $ws.Range('B4') 'Pó descolorante fictício; a granel'; Texto $ws.Range('C4') 'KG'
  $ws.Range('A5').Value2 = 456; Texto $ws.Range('B5') 'Condicionador fictício'; Texto $ws.Range('C5') 'UN'
  $wb.SaveAs((Join-Path $destino 'produtos.xlsx'), 51)
  $wb.SaveAs((Join-Path $destino 'produtos-excel-utf8.csv'), 62)
  $wb.SaveAs((Join-Path $destino 'produtos-excel-ansi.csv'), 6)
  $wb.Close($false)
  'Fixtures geradas em ' + $destino
} finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
