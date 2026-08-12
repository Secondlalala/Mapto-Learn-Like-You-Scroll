# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

root = Path.cwd()
backend = root / "backend"
frontend_dist = root / "frontend" / "dist"

a = Analysis(
    [str(backend / "desktop_launcher.py")],
    pathex=[str(backend)],
    binaries=[],
    datas=[
        (str(frontend_dist), "frontend/dist"),
        (str(backend / "app.db"), "backend"),
        (str(backend / "runtime_settings.json"), "backend"),
    ],
    hiddenimports=[
        "main",
        "routers.books",
        "routers.cards",
        "routers.chat",
        "routers.settings",
        "routers.tts",
        "routers.upload",
        "services.kokoro_worker",
        "services.sherpa_tts",
        "sherpa_onnx",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="BookConceptApp",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="BookConceptApp",
)
