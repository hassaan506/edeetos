import csv
import json
import os
import glob

# Hardcoded absolute paths to guarantee Windows finds them
DATA_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Data"
BOOKS_DIR = r"D:\6 - FCPS\FCPS WEBSITE\edeetos\Books"

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
        
        print(f"Processing {base_name}...")
        
        questions = []
        subjects_tree = {}
        systems_tree = {}
        exams_tree = {}

        with open(csv_path, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for idx, row in enumerate(reader):
                # Handle IDs robustly
                q_id = row.get('QuestionID', '').strip() or row.get('Question ID', '').strip() or row.get('ID', '').strip() or row.get('id', '').strip()
                if not q_id:
                    q_id = f"{base_name}-q-{idx + 1}"

                subject = row.get('Subject', '').strip()
                chapter = row.get('Chapter', '').strip()
                topic = row.get('Topic', '').strip()
                year = row.get('Year', '').strip() or "Other Years"
                
                exams_raw = row.get('Exams', '') or row.get('Exam', '')
                exams_list = [e.strip() for e in exams_raw.split(',') if e.strip()]

                question_obj = {
                    "id": q_id,
                    "year": year,
                    "exams": exams_list,
                    "subject": subject,
                    "chapter": chapter,
                    "topic": topic,
                    "question": row.get('Question', ''),
                    "options": {
                        "A": row.get('OptionA', ''),
                        "B": row.get('OptionB', ''),
                        "C": row.get('OptionC', ''),
                        "D": row.get('OptionD', ''),
                        "E": row.get('OptionE', '')
                    },
                    "correctAnswer": row.get('CorrectAnswer', '').upper(),
                    "explanation": row.get('Explanation', '')
                }

                # Pre-flag book metadata to save frontend processing time
                if is_book:
                    question_obj["isBookQuestion"] = True
                    question_obj["bookName"] = base_name

                questions.append(question_obj)

                # Build Trees
                if subject not in subjects_tree: subjects_tree[subject] = {}
                if chapter not in subjects_tree[subject]: subjects_tree[subject][chapter] = {}
                subjects_tree[subject][chapter][topic] = subjects_tree[subject][chapter].get(topic, 0) + 1

                if 'system' in chapter.lower():
                    if chapter not in systems_tree: systems_tree[chapter] = {}
                    if subject not in systems_tree[chapter]: systems_tree[chapter][subject] = {}
                    systems_tree[chapter][subject][topic] = systems_tree[chapter][subject].get(topic, 0) + 1

                if year not in exams_tree: exams_tree[year] = {}
                for exam in exams_list:
                    if exam not in exams_tree[year]: exams_tree[year][exam] = {}
                    if subject not in exams_tree[year][exam]: exams_tree[year][exam][subject] = {}
                    exams_tree[year][exam][subject][topic] = exams_tree[year][exam][subject].get(topic, 0) + 1

        # Output JSONs directly into the respective directories
        questions_out = os.path.join(directory, f"{base_name}_questions.json")
        hierarchy_out = os.path.join(directory, f"{base_name}_hierarchy.json")

        with open(questions_out, 'w', encoding='utf-8') as f:
            json.dump(questions, f, indent=4)

        # THE MISSING BLOCK: Re-added the definition of the hierarchy dictionary
        hierarchy = {
            "subjects": subjects_tree,
            "systems": systems_tree,
            "exams": exams_tree
        }
        
        with open(hierarchy_out, 'w', encoding='utf-8') as f:
            json.dump(hierarchy, f, indent=4)

        print(f"  -> Generated JSONs for {len(questions)} unique questions.")

def compile_all():
    print("--- Compiling Course Data ---")
    process_directory(DATA_DIR, is_book=False)
    print("\n--- Compiling Books Data ---")
    process_directory(BOOKS_DIR, is_book=True)

if __name__ == '__main__':
    compile_all()