import csv
import json
import os
import glob
import random


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
        
        # Hierarchy Trees for UI
        subjects_tree = {}
        systems_tree = {}
        exams_tree = {}

        # Dictionaries to hold atomic sharded chunks
        subject_chunks = {}
        exam_chunks = {}

        with open(csv_path, mode='r', encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)

            for row in reader:
                q_id = get_column_value(row, {'questionid', 'question id', 'id'})

                if not q_id:
                    print("  WARNING: Blank QuestionID encountered.")
                    q_id = generate_unique_id({q["id"] for q in questions})

                subject = get_column_value(row, {'subject'}) or "Uncategorized"
                chapter = get_column_value(row, {'chapter'}) or "General"
                topic = get_column_value(row, {'topic'}) or "Unknown Topic"
                difficulty = get_column_value(row, {'difficulty'}) or "medium"

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
                    "hint": get_column_value(row, {'hint'})
                }

                if is_book:
                    question_obj["isBookQuestion"] = True
                    question_obj["bookName"] = base_name
                    if 'rafiullah' in base_name.lower():
                        point_val = get_column_value(row, {'point'})
                        if point_val:
                            question_obj["point"] = point_val

                questions.append(question_obj)

                # =================================================
                # BUILD HIERARCHY TREES (For index JSON)
                # =================================================
                
                # Subject View Hierarchy
                if subject not in subjects_tree:
                    subjects_tree[subject] = {}
                if chapter not in subjects_tree[subject]:
                    subjects_tree[subject][chapter] = {}
                subjects_tree[subject][chapter][topic] = subjects_tree[subject][chapter].get(topic, 0) + 1

                # System View Hierarchy
                if 'system' in chapter.lower():
                    if chapter not in systems_tree:
                        systems_tree[chapter] = {}
                    if subject not in systems_tree[chapter]:
                        systems_tree[chapter][subject] = {}
                    systems_tree[chapter][subject][topic] = systems_tree[chapter][subject].get(topic, 0) + 1

                # Past Papers Hierarchy (Year -> Specialty -> Exam -> Count)
                if years_list or specialty_list or exams_list:
                    max_len = max(len(years_list), len(specialty_list), len(exams_list))
                    for i in range(max_len):
                        y = years_list[i] if i < len(years_list) else (years_list[-1] if years_list else "Unknown Year")
                        spec = specialty_list[i] if i < len(specialty_list) else (specialty_list[-1] if specialty_list else "Unknown Specialty")
                        exam = exams_list[i] if i < len(exams_list) else (exams_list[-1] if exams_list else "Unknown Exam")
                        
                        if y not in exams_tree:
                            exams_tree[y] = {}
                        if spec not in exams_tree[y]:
                            exams_tree[y][spec] = {}
                        if exam not in exams_tree[y][spec]:
                            exams_tree[y][spec][exam] = 0
                        
                        exams_tree[y][spec][exam] += 1

                        # =================================================
                        # BUILD EXAM CHUNKS (Past Papers)
                        # =================================================
                        if not is_book:
                            exam_key = f"{y}_{spec.lower().replace(' ', '_')}_{exam.lower().replace(' ', '_')}"
                            if exam_key not in exam_chunks:
                                exam_chunks[exam_key] = []
                            
                            # Prevent exact object duplicates in the same file
                            if question_obj not in exam_chunks[exam_key]:
                                exam_chunks[exam_key].append(question_obj)

                # =================================================
                # BUILD SUBJECT CHUNKS (Atomic unit for UI tabs)
                # =================================================
                if not is_book:
                    subj_clean = subject.lower().replace(" ", "_")
                    chap_clean = chapter.lower().replace(" ", "_")

                    subj_key = (subj_clean, chap_clean)
                    if subj_key not in subject_chunks:
                        subject_chunks[subj_key] = []
                    subject_chunks[subj_key].append(question_obj)


        # ========================================================
        # OUTPUT GENERATION
        # ========================================================

        if is_book:
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

            course_dir = os.path.join(directory, base_name)
            subj_dir = os.path.join(course_dir, "subjects")
            exam_dir = os.path.join(course_dir, "exams")
            
            os.makedirs(subj_dir, exist_ok=True)
            os.makedirs(exam_dir, exist_ok=True)

            # Output Subject Chunks (Atomic files for both Subject and System views)
            for (s_clean, c_clean), q_list in subject_chunks.items():
                chunk_path = os.path.join(subj_dir, f"{s_clean}_{c_clean}.json")
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    json.dump(q_list, f, indent=4, ensure_ascii=False)

            # Output Exam Chunks
            for exam_key, q_list in exam_chunks.items():
                chunk_path = os.path.join(exam_dir, f"{exam_key}.json")
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    json.dump(q_list, f, indent=4, ensure_ascii=False)

            total_shards = len(subject_chunks) + len(exam_chunks)
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


if __name__ == '__main__':
    compile_all()