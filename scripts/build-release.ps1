$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$ReleaseDir = Join-Path $ProjectRoot "release"

$env:NPM_CONFIG_CACHE = Join-Path $ProjectRoot ".tooling\npm-cache"
$env:NPM_CONFIG_PREFIX = Join-Path $ProjectRoot ".tooling\npm-global"
$env:CARGO_HOME = Join-Path $ProjectRoot ".tooling\cargo"
$ProjectRustup = Join-Path $ProjectRoot ".tooling\rustup"
if (Test-Path (Join-Path $ProjectRustup "toolchains")) {
    $env:RUSTUP_HOME = $ProjectRustup
}
$env:CARGO_TARGET_DIR = Join-Path $ProjectRoot ".build\cargo-target"
$env:Path = "$(Join-Path $env:CARGO_HOME 'bin');$env:Path"

Set-Location $ProjectRoot
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
& $NodeExe (Join-Path $ProjectRoot "node_modules\typescript\bin\tsc") --noEmit
& $NodeExe (Join-Path $ProjectRoot "node_modules\vite\bin\vite.js") build
# Tauri embeds frontend assets into the binary. Cargo does not reliably notice a
# changed dist asset when no Rust source changed, so clear only AiPin's release
# package artifacts before the final link. Dependency artifacts stay cached.
cargo.exe clean --release --package aipin --manifest-path "src-tauri\Cargo.toml"
cargo.exe build --release --manifest-path "src-tauri\Cargo.toml"
New-Item -ItemType Directory -Force $ReleaseDir | Out-Null
Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR "release\aipin.exe") -Destination (Join-Path $ReleaseDir "AiPin.exe") -Force
Get-FileHash (Join-Path $ReleaseDir "AiPin.exe") -Algorithm SHA256
