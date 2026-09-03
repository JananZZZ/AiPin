$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent

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
npm.cmd run tauri dev
