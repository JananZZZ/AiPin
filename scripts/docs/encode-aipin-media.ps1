param(
  [string]$FfmpegPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$framesRoot = Join-Path $projectRoot "output\docs-media"
$assetsRoot = Join-Path $projectRoot "docs\assets"

if (-not $FfmpegPath) {
  $FfmpegPath = Join-Path $projectRoot ".tooling\media-tools\node_modules\ffmpeg-static\ffmpeg.exe"
}
if (-not (Test-Path -LiteralPath $FfmpegPath)) {
  throw "FFmpeg was not found at $FfmpegPath. Install the temporary media dependency under .tooling/media-tools first."
}

New-Item -ItemType Directory -Force -Path $assetsRoot | Out-Null

function Invoke-SimpleGif {
  param(
    [string]$Frames,
    [string]$Output,
    [int]$Width,
    [int]$Height,
    [int]$Fps = 8,
    [int]$Colors = 176
  )

  if (-not (Test-Path -LiteralPath $Frames)) {
    throw "Missing real-EXE frame directory: $Frames"
  }

  $inputPattern = Join-Path $Frames "frame-%04d.png"
  $filter = "fps=${Fps},scale=${Width}:${Height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${Width}:${Height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,split[s0][s1];[s0]palettegen=max_colors=${Colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle"
  & $FfmpegPath -hide_banner -loglevel warning -y -framerate 10 -i $inputPattern -filter_complex $filter -loop 0 $Output
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed while creating $Output" }
}

Invoke-SimpleGif (Join-Path $framesRoot "chat-streaming") (Join-Path $assetsRoot "chat-streaming.gif") 960 547 6 128
Invoke-SimpleGif (Join-Path $framesRoot "layout-workspace") (Join-Path $assetsRoot "layout-workspace.gif") 1080 760
Invoke-SimpleGif (Join-Path $framesRoot "models-and-providers") (Join-Path $assetsRoot "models-and-providers.gif") 1000 704
Invoke-SimpleGif (Join-Path $framesRoot "history-and-data") (Join-Path $assetsRoot "history-and-data.gif") 1000 704

$appearanceMain = Join-Path $framesRoot "appearance-live\main\frame-%04d.png"
$appearanceSettings = Join-Path $framesRoot "appearance-live\settings\frame-%04d.png"
$appearanceOutput = Join-Path $assetsRoot "appearance-live.gif"
if (-not (Test-Path -LiteralPath (Join-Path $framesRoot "appearance-live\main")) -or
    -not (Test-Path -LiteralPath (Join-Path $framesRoot "appearance-live\settings"))) {
  throw "Missing real-EXE appearance frame directories"
}
$appearanceFilter = "[0:v]fps=8,scale=548:410:force_original_aspect_ratio=decrease:flags=lanczos,pad=548:410:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[m];[1:v]fps=8,scale=548:410:force_original_aspect_ratio=decrease:flags=lanczos,pad=548:410:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[s];[m][s]hstack=inputs=2,split[x0][x1];[x0]palettegen=max_colors=176:stats_mode=diff[p];[x1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle"
& $FfmpegPath -hide_banner -loglevel warning -y -framerate 10 -i $appearanceMain -framerate 10 -i $appearanceSettings -filter_complex $appearanceFilter -loop 0 $appearanceOutput
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed while creating $appearanceOutput" }

Get-ChildItem -LiteralPath $assetsRoot -Filter "*.gif" |
  Sort-Object Name |
  Select-Object Name, Length
