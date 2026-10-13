@echo off
setlocal
set "SEARCH_ROOT=%~dp0"
set "PROJECT_DIR="
for /f "delims=" %%D in ('powershell -NoProfile -Command "$p = Get-ChildItem -LiteralPath $env:SEARCH_ROOT -Filter package.json -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\release\\' } | Sort-Object { $_.FullName.Length } | Select-Object -First 1; if ($p) { $p.DirectoryName }"') do set "PROJECT_DIR=%%D"
if not defined PROJECT_DIR goto no_project
cd /d "%PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_npm

node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<12)){console.error('Node.js 22.12 ou plus recent est requis.');process.exit(1)}"
if errorlevel 1 goto old_node

echo [1/2] Installation des dependances...
call npm install
if errorlevel 1 goto failed

echo [2/2] Compilation de l'installateur Windows...
call npm run build:win
if errorlevel 1 goto failed

echo.
echo Termine. L'installateur se trouve dans le dossier release.
pause
exit /b 0

:no_node
echo Node.js n'est pas installe ou absent du PATH.
echo Installez Node.js 22.12 ou plus recent, puis relancez ce script.
goto failed

:no_npm
echo npm est introuvable. Reinstallez Node.js 22.12 ou plus recent.
goto failed

:old_node
echo Version de Node.js incompatible. La version 22.12 ou plus recente est requise.
goto failed

:no_project
echo Aucun package.json trouve dans ce dossier ou ses sous-dossiers.
echo Extrayez le ZIP complet, puis relancez ce script depuis son dossier.
goto failed

:failed
echo Echec. Corrigez le message affiche dans cette fenetre puis relancez le script.
pause
exit /b 1
