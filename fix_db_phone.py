import sqlite3

conn = sqlite3.connect('test_db.db')
cursor = conn.cursor()

try:
    print("Додаю колонку 'contact_phone'...")
    cursor.execute("ALTER TABLE suppliers ADD COLUMN contact_phone VARCHAR(20)")
    print("Успіх!")
except Exception as e:
    print(f"Помилка (можливо, колонка вже є?): {e}")

conn.commit()
conn.close()