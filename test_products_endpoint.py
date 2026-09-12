"""
Test script to verify the products endpoint functionality
"""
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database.db import AsyncSessionLocal
from database.models import Product
from sqlalchemy.orm import selectinload
from api.products import ProductWithShareURL


async def test_products_endpoint_logic():
    """
    Test the logic used in the products endpoint to ensure it works correctly
    """
    print("Testing products endpoint logic...")
    
    async with AsyncSessionLocal() as session:
        try:
            # Execute query to get products with their variants (same as in the endpoint)
            stmt = select(Product).options(selectinload(Product.variants))
            result = await session.execute(stmt)
            products = result.scalars().unique().all()
            
            print(f"Found {len(products)} products in the database")
            
            # Process each product to add share_url (same as in the endpoint)
            products_with_share = []
            for product in products:
                # Simulate ProductAPI.model_validate(product) behavior
                # We'll create a simplified representation
                product_dict = {
                    'id': product.id,
                    'sku': getattr(product, 'supplier_sku', 'unknown'),
                    'name': getattr(product, 'name', 'Unknown Product'),
                    'description': getattr(product, 'description', ''),
                    'pictures': getattr(product, 'pictures', []),
                    'category': getattr(product, 'category', ''),
                    'options': [],
                    'variants': [{'id': v.id, 'supplier_offer_id': v.supplier_offer_id, 
                                'final_price': int(v.final_price), 'quantity': v.quantity_in_stock, 
                                'is_available': v.is_available} for v in getattr(product, 'variants', [])]
                }
                
                # Add share_url to the product data
                share_url = f"https://t.me/TavernaBot/app?startapp=product_{product.id}"
                
                # Add the share_url field
                product_dict['share_url'] = share_url
                
                print(f"Product ID: {product.id}, Name: {product.name[:50]}..., Share URL: {share_url}")
                
                products_with_share.append(product_dict)
            
            print(f"\nSuccessfully processed {len(products_with_share)} products with share URLs")
            return products_with_share

        except Exception as e:
            print(f"Error in test: {e}")
            import traceback
            traceback.print_exc()
            return []


if __name__ == "__main__":
    asyncio.run(test_products_endpoint_logic())