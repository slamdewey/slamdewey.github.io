@echo off
echo Building project...
call npm run build:prod

:: we need to create this 404.html for ghpages to work with angular router
echo Duplicating index.html into 404.html
type "%CD%\docs\index.html" >> "%CD%\docs\404.html"

echo Staging Commits...
call git add docs/*
call git commit -m "rebuilding"
echo Pushing...
call git push
echo Manual Deploy Succesful