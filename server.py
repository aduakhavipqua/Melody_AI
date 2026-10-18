"""
MelodyFind AI: server FastAPI.

  GET  /              -> giao diện tĩnh (static/index.html)
  GET  /api/health    -> {"status": "ok", "model_ready": bool}
  POST /api/predict   -> nhận file WAV 16 kHz mono + mode, trả Top-10 kết quả từ model

Chạy:  uvicorn server:app --reload --port 8000
"""
import io
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import model_adapter as adapter

ROOT = Path(__file__).parent
TARGET_SR = 16000
DEFAULT_WEIGHTS = {"audio": 0.4, "melody": 0.3, "lyrics": 0.3}

app = FastAPI(title="MelodyFind AI")
adapter.load()

# Gắn thư mục static để FastAPI phục vụ file HTML, CSS, JS
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "model_ready": adapter.is_ready()}


@app.post("/api/predict")
async def predict(file: UploadFile = File(...), mode: str = Form("hum")):
    if not adapter.is_ready():
        raise HTTPException(503, "Chưa gắn model đã xuất (xem model_adapter.py).")
    if mode not in ("say", "hum", "lyrics"):
        raise HTTPException(400, "mode phải là say, hum hoặc lyrics.")

    raw = await file.read()
    try:
        wav, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    except Exception:
        raise HTTPException(400, "Không đọc được file âm thanh.")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != TARGET_SR:
        from scipy.signal import resample_poly
        from math import gcd
        g = gcd(int(sr), TARGET_SR)
        wav = resample_poly(wav, TARGET_SR // g, int(sr) // g).astype(np.float32)

    t0 = time.perf_counter()
    out = adapter.predict(wav, TARGET_SR, mode)
    latency = int((time.perf_counter() - t0) * 1000)

    results = []
    for r in out["results"][:10]:
        a, m, l = float(r["audio"]), float(r["melody"]), float(r["lyrics"])
        w = out.get("weights", DEFAULT_WEIGHTS)
        results.append({
            "title": r["title"], "artist": r["artist"],
            "audio": round(a * 100 if a <= 1 else a), "melody": round(m * 100 if m <= 1 else m),
            "lyrics": round(l * 100 if l <= 1 else l),
            "match": round((w["audio"] * a + w["melody"] * m + w["lyrics"] * l) * (100 if max(a, m, l) <= 1 else 1)),
        })
    results.sort(key=lambda x: x["match"], reverse=True)
    return {"results": results, "weights": out.get("weights", DEFAULT_WEIGHTS), "latency_ms": latency}