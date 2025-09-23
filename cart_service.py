# services/cart_service.py
# Цей файл - заглушка, яка імітує роботу з кошиком.
# В майбутньому тут буде логіка роботи з базою даних або GCS.

_user_carts = {}

async def add_item(user_id: int, sku: str, offer_id: str, quantity: int):
    if user_id not in _user_carts:
        _user_carts[user_id] = []
    
    # TODO: Додати логіку оновлення кількості, якщо товар вже є
    from services import xml_parser # локальний імпорт, щоб уникнути циклічності
    product = await xml_parser.get_product_by_sku(sku)
    size_info = next((o for o in product['offers'] if o['offer_id'] == offer_id), None)

    _user_carts[user_id].append({
        'sku': sku,
        'offer_id': offer_id,
        'quantity': quantity,
        'name': product['name'],
        'size': size_info['size'],
        'final_price': product['final_price']
    })
    print(f"Кошик для {user_id}: {_user_carts[user_id]}")

async def get_cart(user_id: int):
    return _user_carts.get(user_id, [])

async def clear_cart(user_id: int):
    if user_id in _user_carts:
        _user_carts[user_id] = []
