# Cursor++ k0baya Local 0.0.11-company.0

Patched by: k0baya

> Internal team use only. Unauthorized modification, redistribution, or resale is prohibited.

Upstream: @cometix/ccursor@0.0.11

## Windows install

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm __CCURSOR_RELEASE_BASE_URL__/install.ps1 | iex"
```

## macOS install

```bash
/bin/bash -c "$(curl -fsSL __CCURSOR_RELEASE_BASE_URL__/install.sh)"
```

## Windows uninstall

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm __CCURSOR_RELEASE_BASE_URL__/uninstall.ps1 | iex"
```

## macOS uninstall

```bash
/bin/bash -c "$(curl -fsSL __CCURSOR_RELEASE_BASE_URL__/uninstall.sh)"
```

## Required Cursor settings

- Cursor network mode: HTTP/1.1
- Cursor++ BYOK status: ON
- Recommended orientation: vertical

## Assets

- cometix-ccursor-0.0.11-company.0.tgz
- cursor2plus-0.0.11-company.vsix
- patch-report.json
- latest.json
