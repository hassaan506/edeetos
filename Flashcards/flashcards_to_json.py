import csv
import json
import os
import glob
import random

# ============================================================
# PATHS
# ============================================================
FLASHCARDS_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Flashcards"

# ============================================================
# ID SETTINGS
# ============================================================
ID_LENGTH = 8
# Removed easily confused characters (0/O, 1/I)
ID_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# ============================================================
# HELPER FUNCTIONS
# ============================================================
def get_column_value(row, possible_names):
    """Safely extract a column value regardless of minor formatting differences."""
    for key, value in row.items():
        if key and key.strip().lower() in possible_names:
            return value.strip() if value else ""
    return ""

def is_high_yield(val):
    """Convert string values to a strict boolean."""
    return str(val).strip().lower() in ['yes', 'true', '1', 'y', 'high', 'high-yield']

def generate_unique_id(existing_ids):
    """Generate a random ID with an 'fc-' prefix that does not already exist."""
    while True:
        new_id = 'fc-' + ''.join(random.choices(ID_CHARACTERS, k=ID_LENGTH)).lower()
        if new_id not in existing_ids:
            return new_id

# ============================================================
# ASSIGN IDs TO CSV (PERSISTENT TRACKING)
# ============================================================
def assign_flashcard_ids(csv_path):
    """
    Reads the CSV, preserves existing FlashcardIDs,
    generates new IDs for blank rows, and overwrites the CSV.
    """
    print("  Checking FlashcardIDs...")
    rows = []
    fieldnames = None

    # Read CSV
    with open(csv_path, mode='r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames

        if not fieldnames:
            print("  ERROR: CSV has no headers.")
            return False

        # Find the ID column
        id_column = None
        for field in fieldnames:
            if field and field.strip().lower() in {'flashcardid', 'flashcard id', 'id'}:
                id_column = field
                break

        if id_column is None:
            print("  ERROR: 'FlashcardID' or 'ID' column not found in CSV. Please add it.")
            return False

        for row in reader:
            rows.append(row)

    # Collect existing IDs
    existing_ids = set()
    for row in rows:
        f_id = row.get(id_column, "").strip()
        if f_id:
            existing_ids.add(f_id.lower())

    # Assign IDs to blank cells
    new_ids_count = 0
    for row in rows:
        f_id = row.get(id_column, "").strip()
        if not f_id:
            new_id = generate_unique_id(existing_ids)
            row[id_column] = new_id
            existing_ids.add(new_id)
            new_ids_count += 1

    # Write BACK to the SAME CSV file
    if new_ids_count > 0:
        with open(csv_path, mode='w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)

    print(f"  -> {new_ids_count} new FlashcardID(s) assigned.")
    print(f"  -> {len(existing_ids)} total unique IDs found.")
    return True

# ============================================================
# PROCESS DIRECTORY
# ============================================================
def compile_flashcards():
    print("--- Compiling Flashcard Decks ---")

    if not os.path.exists(FLASHCARDS_DIR):
        print(f"Directory not found: {FLASHCARDS_DIR}")
        return

    csv_files = glob.glob(os.path.join(FLASHCARDS_DIR, '*.csv'))

    if not csv_files:
        print(f"No CSV files found in: {FLASHCARDS_DIR}")
        return

    for csv_path in csv_files:
        filename = os.path.basename(csv_path)
        base_name = os.path.splitext(filename)[0]
        
        print(f"\nProcessing {base_name}...")

        # 1. Assign missing IDs directly to the CSV
        success = assign_flashcard_ids(csv_path)
        if not success:
            continue

        # 2. Read the updated CSV and build the JSON array
        flashcards = []

        with open(csv_path, mode='r', encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                fc_id = get_column_value(row, {'flashcardid', 'flashcard id', 'id'})
                
                # Failsafe if ID is somehow still blank
                if not fc_id:
                    fc_id = generate_unique_id({q.get("FlashcardID") for q in flashcards})

                # Build the exact JSON schema the web app expects
                fc_obj = {
                    "FlashcardID": fc_id,
                    "System": get_column_value(row, {'system'}),
                    "Chapter": get_column_value(row, {'chapter'}),
                    "Topic": get_column_value(row, {'topic'}),
                    "Stem": get_column_value(row, {'stem', 'question'}),
                    "Answer": get_column_value(row, {'answer', 'correctanswer'}),
                    "Trick": get_column_value(row, {'trick', 'mnemonic', 'trick/mnemonic'}),
                    "Image": get_column_value(row, {'image', 'img', 'picture'}),
                    "HighYield": is_high_yield(get_column_value(row, {'highyield', 'high yield', 'high-yield'}))
                }
                
                flashcards.append(fc_obj)

        # 3. Save the JSON file exactly matching the CSV filename
        json_out = os.path.join(FLASHCARDS_DIR, f"{base_name}.json")
        
        with open(json_out, 'w', encoding='utf-8') as f:
            json.dump(flashcards, f, indent=4, ensure_ascii=False)

        print(f"  -> Generated JSON for {len(flashcards)} flashcards at {json_out}.")

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    compile_flashcards()