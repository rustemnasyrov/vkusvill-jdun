from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import admin, auth, courier
from app.services.bookings import BookingError

app = FastAPI(title="Самозапись курьеров на смены", version="0.1.0")

_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router)
app.include_router(courier.router)
app.include_router(admin.router)


@app.exception_handler(BookingError)
async def booking_error_handler(_, exc: BookingError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
