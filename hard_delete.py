# hard_delete.py
"""
Одноразове ПОВНЕ фізичне видалення магазину.
Минає Soft Delete і SupplierHistoryLog.

Запуск:
    python hard_delete.py
"""
import asyncio
import sys
from pathlib import Path

current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

from sqlalchemy import delete, select, update

from database.db import AsyncSessionLocal
from database.models import (
    Order,
    OrderItem,
    PaidService,
    PriceRule,
    Product,
    ProductOption,
    ProductOptionValue,
    ProductVariant,
    Supplier,
    product_variant_option_values,
    supplier_channels,
)


async def hard_delete_supplier() -> None:
    if AsyncSessionLocal is None:
        print("❌ AsyncSessionLocal не ініціалізовано — перевір DATABASE_URL у .env.")
        return

    raw = input("Введіть ID магазину для повного знищення: ").strip()
    try:
        supplier_id = int(raw)
    except ValueError:
        print("❌ ID має бути числом.")
        return

    async with AsyncSessionLocal() as session:
        supplier = await session.get(Supplier, supplier_id)
        if supplier is None:
            print(f"❌ Магазин #{supplier_id} не знайдено.")
            return

        product_ids = list(
            (await session.execute(select(Product.id).where(Product.supplier_id == supplier_id)))
            .scalars()
            .all()
        )
        variant_ids = []
        option_ids = []
        if product_ids:
            variant_ids = list(
                (
                    await session.execute(
                        select(ProductVariant.id).where(ProductVariant.product_id.in_(product_ids))
                    )
                )
                .scalars()
                .all()
            )
            option_ids = list(
                (
                    await session.execute(
                        select(ProductOption.id).where(ProductOption.product_id.in_(product_ids))
                    )
                )
                .scalars()
                .all()
            )

        if variant_ids:
            await session.execute(
                delete(product_variant_option_values).where(
                    product_variant_option_values.c.variant_id.in_(variant_ids)
                )
            )
        if option_ids:
            await session.execute(
                delete(ProductOptionValue).where(ProductOptionValue.option_id.in_(option_ids))
            )
            await session.execute(delete(ProductOption).where(ProductOption.id.in_(option_ids)))
        if variant_ids:
            await session.execute(delete(ProductVariant).where(ProductVariant.id.in_(variant_ids)))

        await session.execute(delete(OrderItem).where(OrderItem.supplier_id == supplier_id))
        if product_ids:
            await session.execute(delete(OrderItem).where(OrderItem.product_id.in_(product_ids)))
            await session.execute(delete(PaidService).where(PaidService.product_id.in_(product_ids)))
        await session.execute(delete(PaidService).where(PaidService.supplier_id == supplier_id))

        order_ids = list(
            (await session.execute(select(Order.id).where(Order.supplier_id == supplier_id)))
            .scalars()
            .all()
        )
        if order_ids:
            await session.execute(
                update(Order).where(Order.parent_order_id.in_(order_ids)).values(parent_order_id=None)
            )
            await session.execute(
                update(Order).where(Order.id.in_(order_ids)).values(parent_order_id=None)
            )
            await session.execute(delete(OrderItem).where(OrderItem.order_id.in_(order_ids)))
            await session.execute(delete(PaidService).where(PaidService.order_id.in_(order_ids)))
            await session.execute(delete(Order).where(Order.id.in_(order_ids)))

        await session.execute(delete(PriceRule).where(PriceRule.supplier_id == supplier_id))
        await session.execute(
            delete(supplier_channels).where(supplier_channels.c.supplier_id == supplier_id)
        )
        await session.execute(delete(Product).where(Product.supplier_id == supplier_id))
        await session.delete(supplier)
        await session.commit()

    print("Магазин і всі його товари знищено назавжди.")


if __name__ == "__main__":
    asyncio.run(hard_delete_supplier())
