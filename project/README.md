# kinotch-api Project Overlay

This overlay records the KiNoTch Project boundary for the existing API
repository. Worker implementation and deployment documentation remain at the
repository root.

## 概要

このRepositoryは KiNoTch. Repository Base に準拠します。

- 個別情報・仕様・実装: project/
- 個別プロジェクト定義: project/project.json
- 個別仕様索引: project/docs/INDEX.md
- 現在状態: project/docs/CURRENT_STATE.md
- 共通操作: .kinotch/README_BASE.md

## Project-owned surfaces

- API Gateway and Hono routes
- Cloudflare Worker bindings and provider policies
- Text transformation and generated snapshot pipelines
- MCP Worker and MCP-specific request handling

## 最短利用方法

```powershell
.\knt.cmd doctor
.\knt.cmd setup
.\knt.cmd verify
```
