# Usage: phone.ps1 <action> [args]
#   shot <out.png>        screenshot of the emulator, scaled to 432 px wide
#   tap <text>            taps the first element whose text (or content-desc) is exactly <text>
#   type <text>           types into the focused field
#   texts                 lists the visible texts
# Talks to the emulator only (-s emulator-5554), never to a phone plugged into the PC.
param([string]$Action, [string]$Arg)
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$device = 'emulator-5554'

function Get-Ui {
  [xml](& $adb -s $device exec-out uiautomator dump /dev/tty | Out-String).Replace('UI hierchary dumped to: /dev/tty', '')
}

switch ($Action) {
  'shot' {
    $raw = Join-Path $env:TEMP 'avchetan-phone-raw.png'
    & cmd /c "`"$adb`" -s $device exec-out screencap -p > `"$raw`""
    Add-Type -AssemblyName System.Drawing
    $image = [System.Drawing.Image]::FromFile($raw)
    $width = 432; $height = [int]($image.Height * $width / $image.Width)
    $scaled = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($scaled)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($image, 0, 0, $width, $height)
    $scaled.Save($Arg, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $scaled.Dispose(); $image.Dispose()
    "saved $Arg"
  }
  'tap' {
    $node = (Get-Ui).SelectNodes('//node') | Where-Object { $_.text -eq $Arg -or $_.'content-desc' -eq $Arg } | Select-Object -First 1
    if (-not $node) { throw "no element '$Arg'" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb -s $device shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    "tapped $Arg"
  }
  'type' {
    & $adb -s $device shell input text ($Arg.Replace(' ', '%s'))
    "typed"
  }
  'texts' {
    ((Get-Ui).SelectNodes('//node') | ForEach-Object { if ($_.text) { $_.text } elseif ($_.'content-desc') { "[$($_.'content-desc')]" } }) -join ' | '
  }
}
