from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List
import logging

from database.db import get_db, AsyncSessionLocal
from database.models import Product, ProductVariant
from api_models import ProductAPI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/products", tags=["Products"])

class ProductWithShareURL(ProductAPI):
    share_url: str


@router.get("/", response_model=List[ProductWithShareURL])
async def get_all_products(db: AsyncSession = Depends(get_db)):
    """
    Returns a list of all products with share URLs for the Mini App.
    Each product includes a share_url field that points to the product in the Telegram bot.
    """
    try:
        # Execute query to get products with their variants
        stmt = select(Product).options(selectinload(Product.variants))
        result = await db.execute(stmt)
        products = result.scalars().unique().all()

        products_with_share = []
        for product in products:
            # Validate the product using the existing ProductAPI model
            product_api = ProductAPI.model_validate(product)
            
            # Add share_url to the product data
            share_url = f"https://t.me/TavernaBot/app?startapp=product_{product.id}"
            
            # Convert to dict and add the share_url field
            product_dict = product_api.model_dump()
            product_dict['share_url'] = share_url
            
            # Create the extended model with share_url
            product_with_share = ProductWithShareURL(**product_dict)
            products_with_share.append(product_with_share)

        return products_with_share

    except Exception as e:
        logger.error(f"Error in get_all_products: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")