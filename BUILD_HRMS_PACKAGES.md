# HRMS web-package builds

Run these commands from the project root in PowerShell.

## Production (`/HRMS/`)

```powershell
powershell -ExecutionPolicy Bypass -File .\build_hrms_production.ps1
```

Upload `bop-hrms-deploy.zip` to `public_html` and extract it. It creates the
`public_html/HRMS/` folder with all required files.

## Testing (`/hrms-testing/`)

```powershell
powershell -ExecutionPolicy Bypass -File .\build_hrms_testing.ps1
```

Upload `bop-hrms-testing-deploy.zip` to `public_html` and extract it. It
creates `public_html/hrms-testing/`. The testing script keeps the existing
production `bop-hrms-deploy.zip` intact.

Do not extract either archive inside its target folder and do not move files
after extraction: each archive already includes the correct top-level folder.
