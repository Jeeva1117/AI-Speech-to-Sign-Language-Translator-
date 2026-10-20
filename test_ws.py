import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://127.0.0.1:8000/ws/realtime") as ws:
        await ws.send(json.dumps({"type": "text", "text": "I am going to school"}))
        response = await ws.recv()
        print(response)

asyncio.run(test())
