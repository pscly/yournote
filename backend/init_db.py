"""Database initialization script"""
import asyncio
from app.database import init_db


async def main():
    """Initialize database tables"""
    print("Initializing database...")
    await init_db()
    print("Database initialized successfully!")


if __name__ == "__main__":
    asyncio.run(main())
