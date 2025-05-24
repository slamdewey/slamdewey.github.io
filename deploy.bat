:: Gh-Pages bundles the files located in the docs folder of the repository
:: It's then served at https://slamdewey.github.io/
:: This .bat file serves as a script to create, commit, and push new build artifact in the docs folder

@echo off
call npm run build:prod

:: gh-pages & angular router = lots of 404's.
:: easiest (and recommended) fix is to duplicate index into 404
type "%CD%\docs\index.html" >> "%CD%\docs\404.html"

call git add docs/*
call git commit -m "build (auto-rebuild): deploy.bat is creating this new build artifact"
call git push
echo Deploy Complete
