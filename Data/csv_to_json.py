import csv
import json
import os
import glob
import random
import re

# ============================================================
# PATHS
# ============================================================

DATA_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Data"
BOOKS_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Books"

# ============================================================
# ID SETTINGS
# ============================================================

ID_LENGTH = 8
ID_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_column_value(row, possible_names):
    for key, value in row.items():
        if key and key.strip().lower() in possible_names:
            return value.strip() if value else ""
    return ""

def generate_unique_id(existing_ids):
    while True:
        new_id = ''.join(random.choices(ID_CHARACTERS, k=ID_LENGTH))
        if new_id not in existing_ids:
            return new_id

def clean_split(val):
    if not val:
        return []
    return [x.strip() for x in str(val).split(",") if x.strip()]

def sanitize_filename(name):
    if not name:
        return "unknown"
    clean = re.sub(r'[\\/*?:"<>|\s]+', "_", str(name).strip().lower())
    return clean.strip("_")

def parse_exam_info(exam_str, fallback_year, fallback_spec):
    parts = [p.strip() for p in exam_str.split("-")]
    
    exam_year = fallback_year
    exam_spec = fallback_spec
    
    if len(parts) >= 2:
        prefix = parts[0].lower()
        if "surgery" in prefix: exam_spec = "Surgery & Allied"
        elif "medicine" in prefix: exam_spec = "Medicine & Allied"
        elif "gynecology" in prefix or "gyn" in prefix: exam_spec = "Gynecology & Obstetrics"
        elif "anesthesia" in prefix: exam_spec = "Anesthesia"
        elif "radiology" in prefix: exam_spec = "Radiology"
        elif "pathology" in prefix: exam_spec = "Pathology"
        else: exam_spec = parts[0]

        date_part = parts[1]
        if "/" in date_part:
            yy = date_part.split("/")[-1].strip()
            if len(yy) == 2:
                exam_year = "20" + yy
            elif len(yy) == 4:
                exam_year = yy
                
    return exam_year, exam_spec

def save_paginated(base_dir, file_prefix, q_list):
    CHUNK_LIMIT = 200
    for i in range(0, len(q_list), CHUNK_LIMIT):
        page = (i // CHUNK_LIMIT) + 1
        chunk_path = os.path.join(base_dir, f"{file_prefix}_{page}.json")
        with open(chunk_path, 'w', encoding='utf-8') as f:
            json.dump(q_list[i:i + CHUNK_LIMIT], f, indent=4, ensure_ascii=False)

# ============================================================
# ASSIGN IDs TO CSV
# ============================================================

def assign_question_ids(csv_path):
    print(f"  Checking QuestionIDs...")

    rows = []
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

    existing_ids = set()
    for row in rows:
        q_id = row.get(question_id_column, "").strip()
        if q_id:
            existing_ids.add(q_id.upper())

    new_ids_count = 0
    for row in rows:
        q_id = row.get(question_id_column, "").strip()
        if not q_id:
            new_id = generate_unique_id(existing_ids)
            row[question_id_column] = new_id
            existing_ids.add(new_id)
            new_ids_count += 1

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
        subjects_tree = {}
        systems_tree = {}
        exams_tree = {}

        subject_chunks = {}
        system_chunks = {}
        exam_chunks = {}

        with open(csv_path, mode='r', encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)

            for row in reader:
                q_id = get_column_value(row, {'questionid', 'question id', 'id'})
                if not q_id:
                    q_id = generate_unique_id({q["id"] for q in questions})

                subject = get_column_value(row, {'subject'}) or "Uncategorized"
                chapter = get_column_value(row, {'chapter'}) or "General"
                topic = get_column_value(row, {'topic'}) or "Unknown Topic"
                difficulty = get_column_value(row, {'difficulty'}) or "medium"
                
                point_value = get_column_value(row, {'point', 'points'})

                years_list = clean_split(get_column_value(row, {'year'}))
                specialty_list = clean_split(get_column_value(row, {'specialty', 'speciality', 'spec'}))
                exams_list = clean_split(get_column_value(row, {'exams', 'exam'}))

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
                    "hint": get_column_value(row, {'hint'}),
                    "Point": point_value  
                }

                if is_book:
                    question_obj["isBookQuestion"] = True
                    question_obj["bookName"] = base_name
                questions.append(question_obj)

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

                for i, exam in enumerate(exams_list):
                    fb_year = years_list[i] if i < len(years_list) else (years_list[-1] if years_list else "Unknown Year")
                    fb_spec = specialty_list[i] if i < len(specialty_list) else (specialty_list[-1] if specialty_list else "Unknown Specialty")
                    
                    parsed_year, parsed_spec = parse_exam_info(exam, fb_year, fb_spec)
                    
                    if parsed_year not in exams_tree:
                        exams_tree[parsed_year] = {}
                    if parsed_spec not in exams_tree[parsed_year]:
                        exams_tree[parsed_year][parsed_spec] = {}
                    if exam not in exams_tree[parsed_year][parsed_spec]:
                        exams_tree[parsed_year][parsed_spec][exam] = 0
                    
                    exams_tree[parsed_year][parsed_spec][exam] += 1

                    if not is_book:
                        exam_key = f"{sanitize_filename(parsed_year)}_{sanitize_filename(parsed_spec)}_{sanitize_filename(exam)}"
                        if exam_key not in exam_chunks:
                            exam_chunks[exam_key] = []
                        
                        if not any(q['id'] == q_id for q in exam_chunks[exam_key]):
                            exam_chunks[exam_key].append(question_obj)

                if not is_book:
                    subj_clean = sanitize_filename(subject)
                    chap_clean = sanitize_filename(chapter)

                    subj_key = (subj_clean, chap_clean)
                    if subj_key not in subject_chunks:
                        subject_chunks[subj_key] = []
                    if not any(q['id'] == q_id for q in subject_chunks[subj_key]):
                        subject_chunks[subj_key].append(question_obj)

                    if 'system' in chapter.lower():
                        sys_key = (chap_clean, subj_clean)
                        if sys_key not in system_chunks:
                            system_chunks[sys_key] = []
                        if not any(q['id'] == q_id for q in system_chunks[sys_key]):
                            system_chunks[sys_key].append(question_obj)

        if is_book:
            questions_out = os.path.join(directory, f"{base_name}_questions.json")
            with open(questions_out, 'w', encoding='utf-8') as f:
                json.dump(questions, f, indent=4, ensure_ascii=False)
            print(f"  -> Generated {base_name}_questions.json for {len(questions)} questions.")
        else:
            metadata_list = []
            search_index_list = [] 
            
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
                search_index_list.append({
                    "id": q["id"],
                    "q": q["question"]
                })
                
            meta_out = os.path.join(directory, f"{base_name}_metadata.json")
            with open(meta_out, 'w', encoding='utf-8') as f:
                json.dump(metadata_list, f, separators=(',', ':'))

            search_out = os.path.join(directory, f"{base_name}_search_index.json")
            with open(search_out, 'w', encoding='utf-8') as f:
                json.dump(search_index_list, f, separators=(',', ':'))

            hierarchy_out = os.path.join(directory, f"{base_name}_hierarchy.json")
            hierarchy = {
                "subjects": subjects_tree,
                "systems": systems_tree,
                "exams": exams_tree
            }
            with open(hierarchy_out, 'w', encoding='utf-8') as f:
                json.dump(hierarchy, f, indent=4, ensure_ascii=False)

            course_dir = os.path.join(directory, base_name)
            subj_dir = os.path.join(course_dir, "subjects")
            sys_dir = os.path.join(course_dir, "systems")
            exam_dir = os.path.join(course_dir, "exams")
            
            os.makedirs(subj_dir, exist_ok=True)
            os.makedirs(sys_dir, exist_ok=True)
            os.makedirs(exam_dir, exist_ok=True)

            for (s_clean, c_clean), q_list in subject_chunks.items():
                save_paginated(subj_dir, f"{s_clean}_{c_clean}", q_list)

            for (c_clean, s_clean), q_list in system_chunks.items():
                save_paginated(sys_dir, f"{c_clean}_{s_clean}", q_list)

            for exam_key, q_list in exam_chunks.items():
                save_paginated(exam_dir, exam_key, q_list)

            total_shards = len(subject_chunks) + len(system_chunks) + len(exam_chunks)
            print(f"  -> Generated {base_name}_metadata.json")
            print(f"  -> Generated {base_name}_search_index.json")
            print(f"  -> Generated {base_name}_hierarchy.json")
            print(f"  -> Generated {total_shards} paginated micro-chunks in {base_name}/ folder.")

# ============================================================
# COMPILE EVERYTHING
# ============================================================

def compile_all():
    print("--- Compiling Course Data ---")
    process_directory(DATA_DIR, is_book=False)

    print("\n--- Compiling Books Data ---")
    process_directory(BOOKS_DIR, is_book=True)

if __name__ == '__main__':
    compile_all()