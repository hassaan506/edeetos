import csv
import json
import os
import glob
import random
import string


# ============================================================
# PATHS
# ============================================================

DATA_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Data"
BOOKS_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Books"


# ============================================================
# ID SETTINGS
# ============================================================

ID_LENGTH = 8

# Characters that are easy to confuse have been removed:
# 0/O and 1/I
ID_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_column_value(row, possible_names):
    """
    Safely extract a column value regardless of minor formatting
    differences such as spaces or casing.
    """
    for key, value in row.items():
        if key and key.strip().lower() in possible_names:
            return value.strip() if value else ""
    return ""


def generate_unique_id(existing_ids):
    """
    Generate a random ID and make sure it does not already exist.
    """
    while True:
        new_id = ''.join(random.choices(ID_CHARACTERS, k=ID_LENGTH))
        if new_id not in existing_ids:
            return new_id


def clean_split(val):
    """
    Splits comma-separated strings into a clean list.
    """
    if not val:
        return []
    return [x.strip() for x in str(val).split(",") if x.strip()]


# ============================================================
# ASSIGN IDs TO CSV
# ============================================================

def assign_question_ids(csv_path):
    """
    Reads the CSV, preserves all existing QuestionIDs,
    generates IDs only for blank QuestionID cells,
    and overwrites the same CSV file.
    """
    print(f"  Checking QuestionIDs...")

    rows = []
    fieldnames = None

    # --------------------------------------------------------
    # Read CSV
    # --------------------------------------------------------
    with open(csv_path, mode='r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames

        if not fieldnames:
            print("  ERROR: CSV has no headers.")
            return

        question_id_column = None
        for field in fieldnames:
            if field and field.strip().lower() in {'questionid', 'question id', 'id'}:
                question_id_column = field
                break

        if question_id_column is None:
            print("  ERROR: QuestionID column not found.")
            return

        for row in reader:
            rows.append(row)

    # --------------------------------------------------------
    # Collect all existing IDs
    # --------------------------------------------------------
    existing_ids = set()
    duplicate_ids = []

    for row in rows:
        q_id = row.get(question_id_column, "").strip()
        if q_id:
            normalized_id = q_id.upper()
            if normalized_id in existing_ids:
                duplicate_ids.append(q_id)
            else:
                existing_ids.add(normalized_id)

    if duplicate_ids:
        print("  WARNING: Duplicate QuestionIDs already exist:")
        for duplicate in duplicate_ids:
            print(f"    - {duplicate}")
        print("  Existing IDs were NOT changed.")

    # --------------------------------------------------------
    # Assign IDs ONLY to blank cells
    # --------------------------------------------------------
    new_ids_count = 0
    for row in rows:
        q_id = row.get(question_id_column, "").strip()
        if not q_id:
            new_id = generate_unique_id(existing_ids)
            row[question_id_column] = new_id
            existing_ids.add(new_id)
            new_ids_count += 1

    # --------------------------------------------------------
    # Write BACK to the SAME CSV file
    # --------------------------------------------------------
    with open(csv_path, mode='w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)

    print(f"  -> {new_ids_count} new QuestionID(s) assigned.")
    print(f"  -> {len(existing_ids)} total unique IDs found.")


# ============================================================
# PROCESS DIRECTORY
# ============================================================

def process_directory(directory, is_book=False):

    if not os.path.exists(directory):
        print(f"Directory not found: {directory}")
        return

    csv_files = glob.glob(os.path.join(directory, '*.csv'))

    if not csv_files:
        print(f"No CSV files found in: {directory}")
        return

    for csv_path in csv_files:
        filename = os.path.basename(csv_path)
        base_name = os.path.splitext(filename)[0]

        print(f"\nProcessing {base_name}...")

        assign_question_ids(csv_path)

        questions = []
        
        # Hierarchy Trees for UI
        subjects_tree = {}
        systems_tree = {}
        exams_tree = {}

        # Dictionaries to hold sharded chunks for Main Course
        subject_chunks = {}
        system_chunks = {}
        exam_chunks = {}

        with open(csv_path, mode='r', encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)

            for row in reader:

                # ------------------------------------------------
                # Question ID & Standard Metadata
                # ------------------------------------------------
                q_id = get_column_value(row, {'questionid', 'question id', 'id'})

                if not q_id:
                    print("  WARNING: Blank QuestionID encountered.")
                    q_id = generate_unique_id({q["id"] for q in questions})

                subject = get_column_value(row, {'subject'}) or "Uncategorized"
                chapter = get_column_value(row, {'chapter'}) or "General"
                topic = get_column_value(row, {'topic'}) or "Unknown Topic"
                difficulty = get_column_value(row, {'difficulty'}) or "medium"

                # ------------------------------------------------
                # Arrays for Year, Specialty, Exams
                # ------------------------------------------------
                years_raw = get_column_value(row, {'year'})
                years_list = clean_split(years_raw)

                # Catching multiple spellings for Specialty
                specialty_raw = get_column_value(row, {'specialty', 'speciality', 'spec'})
                specialty_list = clean_split(specialty_raw)

                exams_raw = get_column_value(row, {'exams', 'exam'})
                exams_list = clean_split(exams_raw)

                # ------------------------------------------------
                # Question Object Build
                # ------------------------------------------------
                question_obj = {
                    "id": q_id,
                    "year": years_list,
                    "specialty": specialty_list,
                    "exams": exams_list,
                    "subject": subject,
                    "chapter": chapter,
                    "topic": topic,
                    "difficulty": difficulty,
                    "question": get_column_value(row, {'question'}),
                    "options": {
                        "A": get_column_value(row, {'optiona'}),
                        "B": get_column_value(row, {'optionb'}),
                        "C": get_column_value(row, {'optionc'}),
                        "D": get_column_value(row, {'optiond'}),
                        "E": get_column_value(row, {'optione'})
                    },
                    "correctAnswer": get_column_value(row, {'correctanswer'}).upper(),
                    "explanation": get_column_value(row, {'explanation'}),
                    "hint": get_column_value(row, {'hint'})
                }

                # ------------------------------------------------
                # Book Metadata & Specific Columns
                # ------------------------------------------------
                if is_book:
                    question_obj["isBookQuestion"] = True
                    question_obj["bookName"] = base_name

                    # Rafiullah Point Extraction
                    if 'rafiullah' in base_name.lower():
                        point_val = get_column_value(row, {'point'})
                        if point_val:
                            question_obj["point"] = point_val

                questions.append(question_obj)

                # =================================================
                # BUILD HIERARCHY TREES (For index JSON)
                # =================================================
                if subject not in subjects_tree:
                    subjects_tree[subject] = {}
                if chapter not in subjects_tree[subject]:
                    subjects_tree[subject][chapter] = {}
                subjects_tree[subject][chapter][topic] = subjects_tree[subject][chapter].get(topic, 0) + 1

                if 'system' in chapter.lower():
                    if chapter not in systems_tree:
                        systems_tree[chapter] = {}
                    if subject not in systems_tree[chapter]:
                        systems_tree[chapter][subject] = {}
                    systems_tree[chapter][subject][topic] = systems_tree[chapter][subject].get(topic, 0) + 1

                if years_list:
                    for y in years_list:
                        if y not in exams_tree:
                            exams_tree[y] = {}
                        for exam in exams_list:
                            if exam not in exams_tree[y]:
                                exams_tree[y][exam] = {}
                            if subject not in exams_tree[y][exam]:
                                exams_tree[y][exam][subject] = {}
                            exams_tree[y][exam][subject][topic] = exams_tree[y][exam][subject].get(topic, 0) + 1

                # =================================================
                # BUILD SHARDED CHUNKS (Main Course Only)
                # =================================================
                if not is_book:
                    subj_clean = subject.lower().replace(" ", "_")
                    chap_clean = chapter.lower().replace(" ", "_")

                    # 1. Subject Chunks: anatomy_urinary_system.json
                    subj_key = (subj_clean, chap_clean)
                    if subj_key not in subject_chunks:
                        subject_chunks[subj_key] = []
                    subject_chunks[subj_key].append(question_obj)

                    # 2. System Chunks: urinary_system_anatomy.json
                    if 'system' in chapter.lower():
                        sys_key = (chap_clean, subj_clean)
                        if sys_key not in system_chunks:
                            system_chunks[sys_key] = []
                        system_chunks[sys_key].append(question_obj)

                    # 3. Exam Chunks: 2026_surgery.json
                    max_len = max(len(years_list), len(specialty_list))
                    if max_len > 0:
                        for i in range(max_len):
                            y = years_list[i] if i < len(years_list) else years_list[-1] if years_list else "unknown"
                            spec = specialty_list[i] if i < len(specialty_list) else specialty_list[-1] if specialty_list else "unknown"
                            
                            exam_key = f"{y}_{spec.lower().replace(' ', '_')}"
                            if exam_key not in exam_chunks:
                                exam_chunks[exam_key] = []
                            
                            # Prevent exact object duplicates in the same file if mapping overlaps
                            if question_obj not in exam_chunks[exam_key]:
                                exam_chunks[exam_key].append(question_obj)


        # ========================================================
        # OUTPUT GENERATION
        # ========================================================

        if is_book:
            # Books remain monolithic with all full text
            questions_out = os.path.join(directory, f"{base_name}_questions.json")
            with open(questions_out, 'w', encoding='utf-8') as f:
                json.dump(questions, f, indent=4, ensure_ascii=False)
            
            print(f"  -> Generated {base_name}_questions.json for {len(questions)} questions.")

        else:
            # Main Course: Output Lightweight Metadata Index
            metadata_list = []
            for q in questions:
                metadata_list.append({
                    "id": q["id"],
                    "year": q["year"],
                    "exams": q["exams"],
                    "subject": q["subject"],
                    "chapter": q["chapter"],
                    "topic": q["topic"],
                    "difficulty": q["difficulty"]
                })
                
            meta_out = os.path.join(directory, f"{base_name}_metadata.json")
            with open(meta_out, 'w', encoding='utf-8') as f:
                # Use separators to minify the file and save maximum space
                json.dump(metadata_list, f, separators=(',', ':'))

            # Main Course: Output Hierarchy File
            hierarchy_out = os.path.join(directory, f"{base_name}_hierarchy.json")
            hierarchy = {
                "subjects": subjects_tree,
                "systems": systems_tree,
                "exams": exams_tree
            }
            with open(hierarchy_out, 'w', encoding='utf-8') as f:
                json.dump(hierarchy, f, indent=4, ensure_ascii=False)

            # Create Shard Directories nested inside a specific course folder (e.g., Data/fcps_part1/subjects)
            course_dir = os.path.join(directory, base_name)
            subj_dir = os.path.join(course_dir, "subjects")
            sys_dir = os.path.join(course_dir, "systems")
            exam_dir = os.path.join(course_dir, "exams")
            
            os.makedirs(subj_dir, exist_ok=True)
            os.makedirs(sys_dir, exist_ok=True)
            os.makedirs(exam_dir, exist_ok=True)

            # Output Subject Chunks
            for (s_clean, c_clean), q_list in subject_chunks.items():
                chunk_path = os.path.join(subj_dir, f"{s_clean}_{c_clean}.json")
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    json.dump(q_list, f, indent=4, ensure_ascii=False)

            # Output System Chunks
            for (c_clean, s_clean), q_list in system_chunks.items():
                chunk_path = os.path.join(sys_dir, f"{c_clean}_{s_clean}.json")
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    json.dump(q_list, f, indent=4, ensure_ascii=False)

            # Output Exam Chunks
            for exam_key, q_list in exam_chunks.items():
                chunk_path = os.path.join(exam_dir, f"{exam_key}.json")
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    json.dump(q_list, f, indent=4, ensure_ascii=False)

            total_shards = len(subject_chunks) + len(system_chunks) + len(exam_chunks)
            print(f"  -> Generated {base_name}_metadata.json (Lightweight Index)")
            print(f"  -> Generated {base_name}_hierarchy.json")
            print(f"  -> Generated {total_shards} micro-chunks in {base_name}/ folder.")


# ============================================================
# COMPILE EVERYTHING
# ============================================================

def compile_all():
    print("--- Compiling Course Data ---")
    process_directory(DATA_DIR, is_book=False)

    print("\n--- Compiling Books Data ---")
    process_directory(BOOKS_DIR, is_book=True)


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    compile_all()