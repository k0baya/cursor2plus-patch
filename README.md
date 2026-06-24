# cursor2plus-patch

> **仅供 k0baya 所在团队内部使用。**  
> This repository is for the authorized internal team only. It is **not** an open-source redistribution license.
>
> 未经授权，严禁任何人二次修改、移除署名、重新分发、公开打包、转卖或以任何形式售卖本仓库、脚本、产物或其派生版本。仓库公开仅是为了方便团队成员复制安装命令。

`cursor2plus-patch` builds and publishes a k0baya-branded internal patch of Cursor++ / `@cometix/ccursor`.

This patch currently:

- removes the LinuxDO / Cursor++ Hub login requirement for local team use;
- marks the local status as `patched by k0baya`;
- keeps `k0baya` provenance locked in the build/release verification path so config-only rebranding fails early;
- keeps the original `cometix-space.cursor2plus` extension identity required by Cursor's lower-left BYOK account/glass entry;
- keeps the upstream Provider editor working;
- seeds internal OpenAI-Responses / Anthropic / Gemini provider presets from `config/company-ccursor.json`, so teammates usually only need to fill in their assigned API key.

Reference: upstream usage notes are summarized from [Cursor++ 轻指南 v0.0.11](https://linux.do/t/topic/1957183). This README only documents this internal patched distribution.

## Quick install

Close Cursor first.

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm https://github.com/k0baya/cursor2plus-patch/releases/latest/download/install.ps1 | iex"
```

### macOS / Linux shell

```bash
/bin/bash -c "$(curl -fsSL https://github.com/k0baya/cursor2plus-patch/releases/latest/download/install.sh)"
```

> Do **not** install the VSIX by itself. VSIX-only install is not enough for Cursor's lower-left `χ BYOK ○/◉` account/glass entry. Use the install command above.

## Quick uninstall

Close Cursor first.

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm https://github.com/k0baya/cursor2plus-patch/releases/latest/download/uninstall.ps1 | iex"
```

### macOS / Linux shell

```bash
/bin/bash -c "$(curl -fsSL https://github.com/k0baya/cursor2plus-patch/releases/latest/download/uninstall.sh)"
```

## Required state after install

After installation:

1. Restart Cursor.
2. Set Cursor network mode to **HTTP/1.1**.
3. Make sure Cursor++ BYOK status is **ON** (`BYOK is ON`).
4. Recommended: set Cursor orientation to **vertical** so the Cursor++ configuration panel is easier to find.

Correct working state means: **HTTP/1.1 + Cursor++ BYOK ON**.

## Provider and model rules

The bundled internal presets point to `192.168.50.76:3000`:

- GPT models: use provider type **OpenAI-Responses**. OpenAI-style endpoints usually need `/v1`, so the preset is `http://192.168.50.76:3000/v1`.
- Non-GPT Claude-style models: use provider type **Anthropic**. Configure the base URL before `/v1/messages`, so the preset is `http://192.168.50.76:3000`.
- Gemini models: use provider type **Gemini**. Gemini has not been fully tested here; follow Gemini's official base URL convention. The preset uses `http://192.168.50.76:3000/v1beta`.

Do not mix provider types casually. Cursor++ assigns different prompts/tools to different provider families; cross-mixing GPT/Anthropic/Gemini model types can cause confusing failures.

Normal team usage:

1. Open the seeded provider in the Cursor++ panel.
2. Paste your assigned API key.
3. Confirm the selected model ID is the internal/API model ID, not a leftover official Cursor model name.
4. If needed, adjust context window manually. For GPT-5.x style models, avoid blindly trusting a displayed `1M` context value; use the team-recommended value when provided.

## Update procedure

Updating this patch is always:

1. close Cursor;
2. uninstall this patch;
3. install again from the latest GitHub Release;
4. restart Cursor;
5. verify Cursor network mode is **HTTP/1.1** and Cursor++ BYOK is **ON** (`BYOK is ON`).

If Cursor gets into a broken patch state, the strongest recovery path is to reinstall Cursor, then reinstall this patch.

## Build and release for maintainers

CI/CD is intentionally manual-only for now.

Use GitHub Actions workflow: **Build cursor2plus-patch Release**.

Inputs:

- `version`: `latest` or a fixed upstream version such as `0.0.11`.
- `publish_release`: keep `true` to create/update the GitHub Release used by the one-line install commands.

Local build check:

```bash
npm ci
npm run build:public
```

The release workflow uploads:

- patched npm tarball;
- patched VSIX;
- `latest.json`;
- install/uninstall scripts;
- patch report.

## Internal-use restriction

Again: this repository and its generated artifacts are only for k0baya's authorized internal team. No permission is granted for third-party modification, rebranding, redistribution, marketplace publication, paid packaging, resale, or any commercial use outside that team.

