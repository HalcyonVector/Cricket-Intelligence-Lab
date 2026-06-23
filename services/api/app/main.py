from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import players, matchups, outliers

app = FastAPI(title="Cricket Intelligence Lab API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(players.router)
app.include_router(matchups.router)
app.include_router(outliers.router)

@app.get("/health")
def health():
    return {"status": "ok"}
