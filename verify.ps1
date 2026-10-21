$c = Get-Content 'D:\sistema loja tabacaria\src\renderer\src\css\produtos.css' -Raw
$lines = ($c -split "`n").Count
$o = ([regex]::Matches($c, '\{')).Count
$cl = ([regex]::Matches($c, '\}')).Count
Write-Host "Lines: $lines"
Write-Host "Open braces: $o"
Write-Host "Close braces: $cl"
Write-Host "Balanced: $($o -eq $cl)"

$selectors = @('.modal-produto', '.aba-produto', '.prod-secao-corpo', '.prod-campo\b', '.prod-grid-3', '.prod-grid-4', '.prod-check-badge', '.preco-opcoes', '\.switch\b', '.produto-imagem-box', '.badge-status', '.produto-estoque')
foreach ($s in $selectors) {
    $count = ([regex]::Matches($c, $s)).Count
    Write-Host "$s => $count occurrences"
}
