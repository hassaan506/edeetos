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

        new_id = ''.join(
            random.choices(ID_CHARACTERS, k=ID_LENGTH)
        )

        if new_id not in existing_ids:
            return new_id


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

    with open(
        csv_path,
        mode='r',
        encoding='utf-8-sig',
        newline=''
    ) as f:

        reader = csv.DictReader(f)

        fieldnames = reader.fieldnames

        if not fieldnames:
            print("  ERROR: CSV has no headers.")
            return

        # Find actual QuestionID column
        question_id_column = None

        for field in fieldnames:
            if field and field.strip().lower() in {
                'questionid',
                'question id',
                'id'
            }:
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

    # --------------------------------------------------------
    # Report duplicate IDs
    # --------------------------------------------------------

    if duplicate_ids:

        print("  WARNING: Duplicate QuestionIDs already exist:")

        for duplicate in duplicate_ids:
            print(f"    - {duplicate}")

        print(
            "  Existing IDs were NOT changed."
        )

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

    with open(
        csv_path,
        mode='w',
        encoding='utf-8-sig',
        newline=''
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
            extrasaction='ignore'
        )

        writer.writeheader()
        writer.writerows(rows)

    print(
        f"  -> {new_ids_count} new QuestionID(s) assigned."
    )

    print(
        f"  -> {len(existing_ids)} total unique IDs found."
    )


# ============================================================
# PROCESS DIRECTORY
# ============================================================

def process_directory(directory, is_book=False):

    if not os.path.exists(directory):

        print(f"Directory not found: {directory}")

        return

    csv_files = glob.glob(
        os.path.join(directory, '*.csv')
    )

    if not csv_files:

        print(
            f"No CSV files found in: {directory}"
        )

        return

    for csv_path in csv_files:

        filename = os.path.basename(csv_path)

        base_name = os.path.splitext(filename)[0]

        print(
            f"\nProcessing {base_name}..."
        )

        # ----------------------------------------------------
        # FIRST:
        # Assign / preserve QuestionIDs
        # ----------------------------------------------------

        assign_question_ids(csv_path)

        # ----------------------------------------------------
        # THEN:
        # Read the updated CSV for JSON conversion
        # ----------------------------------------------------

        questions = []

        subjects_tree = {}

        systems_tree = {}

        exams_tree = {}

        with open(
            csv_path,
            mode='r',
            encoding='utf-8-sig',
            newline=''
        ) as f:

            reader = csv.DictReader(f)

            for row in reader:

                # ------------------------------------------------
                # Question ID
                # ------------------------------------------------

                q_id = get_column_value(
                    row,
                    {
                        'questionid',
                        'question id',
                        'id'
                    }
                )

                # This should never be blank now,
                # but keep a safety fallback.
                if not q_id:

                    print(
                        "  WARNING: Blank QuestionID encountered."
                    )

                    q_id = generate_unique_id(
                        {
                            q["id"]
                            for q in questions
                        }
                    )

                # ------------------------------------------------
                # Metadata
                # ------------------------------------------------

                subject = get_column_value(
                    row,
                    {'subject'}
                )

                chapter = get_column_value(
                    row,
                    {'chapter'}
                )

                topic = get_column_value(
                    row,
                    {'topic'}
                )

                year = get_column_value(
                    row,
                    {'year'}
                )

                # ------------------------------------------------
                # Exams
                # ------------------------------------------------

                exams_raw = get_column_value(
                    row,
                    {'exams', 'exam'}
                )

                exams_list = [
                    e.strip()
                    for e in exams_raw.split(',')
                    if e.strip()
                ]

                # ------------------------------------------------
                # Question Object
                # ------------------------------------------------

                question_obj = {

                    "id": q_id,

                    "year": year,

                    "exams": exams_list,

                    "subject": subject,

                    "chapter": chapter,

                    "topic": topic,

                    "question": get_column_value(
                        row,
                        {'question'}
                    ),

                    "options": {

                        "A": get_column_value(
                            row,
                            {'optiona'}
                        ),

                        "B": get_column_value(
                            row,
                            {'optionb'}
                        ),

                        "C": get_column_value(
                            row,
                            {'optionc'}
                        ),

                        "D": get_column_value(
                            row,
                            {'optiond'}
                        ),

                        "E": get_column_value(
                            row,
                            {'optione'}
                        )
                    },

                    "correctAnswer": get_column_value(
                        row,
                        {'correctanswer'}
                    ).upper(),

                    "explanation": get_column_value(
                        row,
                        {'explanation'}
                    ),

                    "hint": get_column_value(
                        row,
                        {'hint'}
                    )
                }

                # ------------------------------------------------
                # Book Metadata
                # ------------------------------------------------

                if is_book:

                    question_obj["isBookQuestion"] = True

                    question_obj["bookName"] = base_name

                questions.append(question_obj)

                # =================================================
                # BUILD TREES
                # =================================================

                if subject not in subjects_tree:

                    subjects_tree[subject] = {}

                if chapter not in subjects_tree[subject]:

                    subjects_tree[subject][chapter] = {}

                subjects_tree[subject][chapter][topic] = \
                    subjects_tree[subject][chapter].get(
                        topic,
                        0
                    ) + 1

                # ------------------------------------------------
                # Systems
                # ------------------------------------------------

                if 'system' in chapter.lower():

                    if chapter not in systems_tree:

                        systems_tree[chapter] = {}

                    if subject not in systems_tree[chapter]:

                        systems_tree[chapter][subject] = {}

                    systems_tree[chapter][subject][topic] = \
                        systems_tree[chapter][subject].get(
                            topic,
                            0
                        ) + 1

                # ------------------------------------------------
                # Exams / Years
                # ------------------------------------------------

                if year:

                    if year not in exams_tree:

                        exams_tree[year] = {}

                    for exam in exams_list:

                        if exam not in exams_tree[year]:

                            exams_tree[year][exam] = {}

                        if subject not in exams_tree[year][exam]:

                            exams_tree[year][exam][subject] = {}

                        exams_tree[year][exam][subject][topic] = \
                            exams_tree[year][exam][subject].get(
                                topic,
                                0
                            ) + 1

        # ========================================================
        # OUTPUT JSON
        # ========================================================

        questions_out = os.path.join(
            directory,
            f"{base_name}_questions.json"
        )

        hierarchy_out = os.path.join(
            directory,
            f"{base_name}_hierarchy.json"
        )

        # --------------------------------------------------------
        # Questions JSON
        # --------------------------------------------------------

        with open(
            questions_out,
            'w',
            encoding='utf-8'
        ) as f:

            json.dump(
                questions,
                f,
                indent=4,
                ensure_ascii=False
            )

        # --------------------------------------------------------
        # Hierarchy JSON
        # --------------------------------------------------------

        hierarchy = {

            "subjects": subjects_tree,

            "systems": systems_tree,

            "exams": exams_tree
        }

        with open(
            hierarchy_out,
            'w',
            encoding='utf-8'
        ) as f:

            json.dump(
                hierarchy,
                f,
                indent=4,
                ensure_ascii=False
            )

        print(
            f"  -> Generated JSONs for "
            f"{len(questions)} questions."
        )


# ============================================================
# COMPILE EVERYTHING
# ============================================================

def compile_all():

    print(
        "--- Compiling Course Data ---"
    )

    process_directory(
        DATA_DIR,
        is_book=False
    )

    print(
        "\n--- Compiling Books Data ---"
    )

    process_directory(
        BOOKS_DIR,
        is_book=True
    )


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':

    compile_all()