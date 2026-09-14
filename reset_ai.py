import asyncio
from sqlalchemy import update
from database.db import AsyncSessionLocal
from database.models import Product

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(Product)
            .where(Product.is_ai_processed.is_(True))
            .values(is_ai_processed=False)
        )
        await db.commit()
        print(f"✅ Скинуто товарів: {result.rowcount}")

if __name__ == "__main__":
    asyncio.run(main())