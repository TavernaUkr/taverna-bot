await load_products_export(force=False)
build_products_index_from_xml(PRODUCTS_CACHE["data"])
found=0; suggestion=0; not_found=0
hits=[]
for i in range(1,10001):
    q = str(i)
    p = await check_article_or_name(q)
    if p:
        if p.get("suggestion"):
            suggestion += 1
        else:
            found += 1
        hits.append((i, p.get("sku"), p.get("name")))
    else:
        not_found += 1
# print summary and optionally write hits to CSV
