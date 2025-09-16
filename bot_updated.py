# ---------------- Debug handlers (temporary) ----------------
@router.message(Command("debug_index_check"))
async def cmd_debug_index_check(msg: Message):
    """
    /debug_index_check 1056
    Повертає, чи є ключі SKU у PRODUCTS_INDEX['by_sku'] і показує приклади ключів.
    """
    try:
        arg = (msg.text or "").split(maxsplit=1)
        sku = arg[1].strip() if len(arg) > 1 else ""
        norm = normalize_sku(sku) if sku else sku
        by_sku = PRODUCTS_INDEX.get("by_sku", {})
        found_norm = norm in by_sku if norm else False
        found_raw = sku in by_sku if sku else False
        # знайдемо ключі які містять sku або norm
        matching = [k for k in list(by_sku.keys()) if sku and sku in k or (norm and norm in k)]
        text = f"SKU={sku}\nnorm={norm}\nby_sku has norm? {found_norm}\nby_sku has raw? {found_raw}\nmatches sample: {matching[:20]}"
        await msg.answer(f"<pre>{text}</pre>", parse_mode="HTML")
    except Exception:
        logger.exception("debug_index_check failed")
        await msg.answer("debug failed")

@router.message(Command("debug_findraw"))
async def cmd_debug_findraw(msg: Message):
    """
    /debug_findraw 1056
    Повертає список products у all_products, де vendor_code або offer_id == 1056.
    """
    try:
        arg = (msg.text or "").split(maxsplit=1)
        key = arg[1].strip() if len(arg) > 1 else ""
        found = []
        for p in PRODUCTS_INDEX.get("all_products", []):
            if key and (key == (p.get("vendor_code") or "") or key == (p.get("offer_id") or "")):
                found.append({"offer_id": p.get("offer_id"), "vendor_code": p.get("vendor_code"), "name": p.get("name")})
        await msg.answer(f"Found {len(found)} items: {found[:10]}")
    except Exception:
        logger.exception("debug_findraw failed")
        await msg.answer("debug failed")

@router.message(Command("debug_lookup"))
async def cmd_debug_lookup(msg: Message):
    """
    /debug_lookup 1056
    Викликає find_product_by_sku і повертає результат (product, method).
    """
    try:
        arg = (msg.text or "").split(maxsplit=1)
        key = arg[1].strip() if len(arg) > 1 else ""
        norm = normalize_sku(key) if key else key
        prod, method = find_product_by_sku(norm) if norm else (None, "empty")
        await msg.answer(f"lookup: key={key} norm={norm} found={bool(prod)} method={method}\nprod_sample={prod and {'offer_id':prod.get('offer_id'),'vendor_code':prod.get('vendor_code'),'name':prod.get('name')}}")
    except Exception:
        logger.exception("debug_lookup failed")
        await msg.answer("debug failed")
# -------------------------------------------------------------
