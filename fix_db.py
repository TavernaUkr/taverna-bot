import sqlite3

conn = sqlite3.connect('test_db.db')
cursor = conn.cursor()

try:
    # 1. Додаємо колонку key
    print("Додаю колонку 'key'...")
    cursor.execute("ALTER TABLE suppliers ADD COLUMN key VARCHAR(50)")
    print("Успіх!")
except Exception as e:
    print(f"Помилка (можливо, колонка вже є?): {e}")

try:
    # 2. Робимо її унікальною (SQLite не підтримує ADD CONSTRAINT UNIQUE легко, але індекс допоможе)
    print("Створюю індекс для 'key'...")
    cursor.execute("CREATE UNIQUE INDEX ix_suppliers_key ON suppliers(key)")
    print("Успіх!")
except Exception as e:
    print(f"Помилка індексу: {e}")

conn.commit()
conn.close()