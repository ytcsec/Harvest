# Put the Harvest toolchain on PATH for the current PowerShell session.
#
#   . .\scripts\env.ps1
#
# Windows toolchain note
# ----------------------
# Soroban contracts target wasm32v1-none, but cargo still builds their proc
# macros and build scripts (serde, schemars, thiserror) for the *host*. Two
# things bite on Windows:
#
#   1. Git Bash ships a GNU coreutils `link.exe` that shadows MSVC's linker.
#      Symptom: `link: extra operand ... Try 'link --help'`.
#   2. VS 2022 here has the MSVC compiler but no Windows SDK, so the MSVC
#      linker cannot find kernel32.lib.
#
# Rather than pull down a multi-gigabyte SDK, `contracts/` is pinned to the
# `stable-x86_64-pc-windows-gnu` host toolchain via `rustup override`, which
# links host artifacts with its own bundled linker. The wasm output is
# identical either way -- the host toolchain only builds build-time code.
#
# On macOS/Linux none of this applies; plain `cargo build` works.

$env:Path = "$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\.harvest-bin;$env:Path"

Write-Host "harvest toolchain ready" -ForegroundColor Green
foreach ($t in @('cargo', 'stellar', 'circom', 'node')) {
    $c = Get-Command $t -ErrorAction SilentlyContinue
    if ($c) {
        $v = (& $t --version 2>&1 | Select-Object -First 1)
        Write-Host ("  {0,-8} {1}" -f $t, $v)
    } else {
        Write-Host ("  {0,-8} MISSING" -f $t) -ForegroundColor Red
    }
}
