import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Завантажуємо ключі з .env
load_dotenv()
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(url, key)

def get_all_files(bucket, path):
    all_files = []
    try:
        # Отримуємо вміст поточної папки
        items = supabase.storage.from_(bucket).list(path, {"limit": 1000})
        for item in items:
            if item['name'] == '.emptyFolderPlaceholder':
                continue
            
            current_path = f"{path}/{item['name']}" if path else item['name']
            
            # Якщо немає metadata — це папка, пірнаємо в неї рекурсивно
            if not item.get('metadata'):
                all_files.extend(get_all_files(bucket, current_path))
            else:
                all_files.append(current_path)
    except Exception as e:
        print(f"Помилка читання папки {path}: {e}")
        
    return all_files

def clear_telegram_media():
    print("🔍 Скануємо всі папки та підпапки в telegram_media...")
    bucket = "products"
    base_path = "telegram_media"
    
    files_to_delete = get_all_files(bucket, base_path)
    
    if not files_to_delete:
        print("✅ Папка повністю порожня!")
        return

    print(f"🎯 Знайдено файлів для видалення: {len(files_to_delete)}")
    
    # Supabase краще перетравлює видалення пачками, б'ємо по 100 штук
    chunk_size = 100
    for i in range(0, len(files_to_delete), chunk_size):
        chunk = files_to_delete[i:i + chunk_size]
        print(f"🗑️ Видаляємо партію з {len(chunk)} файлів ({i+1} - {min(i+chunk_size, len(files_to_delete))})...")
        supabase.storage.from_(bucket).remove(chunk)
        
    print("🚀 ВСІ файли та підпапки з telegram_media успішно видалено назавжди!")

if __name__ == "__main__":
    clear_telegram_media()