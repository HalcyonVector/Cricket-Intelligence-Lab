from pydantic import BaseModel

class Sample(BaseModel):
    innings: int | None = None
    balls: int | None = None

class Envelope(BaseModel):
    data: dict | list
    meta: dict
