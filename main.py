
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
HTML_FILE = BASE_DIR / "static" / "index.html"

@app.get("/")
def home():
    if not HTML_FILE.exists():
        return {
            "error": "Chưa tìm thấy index.html",
            "expected_path": str(HTML_FILE)
        }
    return FileResponse(HTML_FILE)

@app.get("/health")
def health():
    return {"status": "ok"}
