<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - EDEETOS</title>
	<link rel="stylesheet" href="global.css">
	<link rel="stylesheet" href="dashboard.css">
    <style>
        /* Custom Dropdown & Badge Styles */
        .select-wrapper {
            position: relative;
            width: 100%;
        }
        .custom-select {
            width: 100%;
            padding: 1rem 1.2rem;
            font-size: 1.05rem;
            color: #1e293b;
            background-color: #f8fafc;
            border: 2px solid #e2e8f0;
            border-radius: 10px;
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            cursor: pointer;
            font-weight: 600;
            outline: none;
            transition: all 0.2s ease;
        }
        .custom-select:focus {
            border-color: #10b981;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
        }
        .select-wrapper::after {
            content: '▼';
            font-size: 0.8rem;
            color: #64748b;
            position: absolute;
            right: 1.2rem;
            top: 50%;
            transform: translateY(-50%);
            pointer-events: none;
        }
        .status-badge {
            display: inline-block;
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 700;
            text-transform: uppercase;
            margin-left: 10px;
            vertical-align: middle;
        }
        .badge-free {
            background: #fffbeb;
            color: #d97706;
            border: 1px solid #fcd34d;
        }
        .badge-pro {
            background: #ecfdf5;
            color: #059669;
            border: 1px solid #6ee7b7;
        }
    </style>
</head>
<body>

    <nav class="navbar">
        <div class="nav-container">
            <a href="index.html" class="nav-logo">
                <img src="Pictures/logo_transparent.png" alt="EDEETOS Logo" class="logo-img">
            </a>
            <ul class="nav-links">
                <li><button id="logout-btn" class="btn-outline" style="font-family: inherit; font-size: 1rem;">Logout</button></li>
            </ul>
        </div>
    </nav>

    <section class="section-container">
		<div class="dashboard-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <h1 style="display: flex; align-items: center;">
                    Welcome, <span id="user-name" class="highlight-text" style="margin-left: 8px;">Doctor</span>
                    <span class="status-badge badge-free" id="subscription-status">Free Tier</span>
                </h1>
                <p>Select your course below to begin.</p>
            </div>
		</div>

        <div class="feature-grid" style="margin-bottom: 2rem;">
			<div class="glass-panel feature-card">
				<div class="icon">📚</div>
				<h3>Study Vault</h3>
				<p>Access notes and lectures for your specific exam.</p>
				<button class="btn-solid mini-btn">Open Vault</button>
			</div>

			<div class="glass-panel feature-card">
				<div class="icon">🩺</div>
				<h3>My Mentor</h3>
				<p>Book a session or message your dedicated guide.</p>
				<button class="btn-solid mini-btn">Contact Mentor</button>
			</div>
		</div>

        <div class="glass-panel" style="padding: 2.5rem; max-width: 600px; margin: 0 auto; text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">✍️</div>
            <h2 style="color: #064e3b; font-size: 1.8rem; margin-bottom: 0.5rem;">Question Bank</h2>
            <p style="color: #64748b; margin-bottom: 2rem;">
                Select your active course. <br>
                <span style="color: #d97706; font-size: 0.85rem; font-weight: 600;">(Free users have limited access to questions)</span>
            </p>

            <div class="select-wrapper" style="text-align: left; margin-bottom: 1.5rem;">
                <label for="course-dropdown" style="display: block; font-weight: 700; color: #334155; margin-bottom: 0.5rem; font-size: 0.9rem; text-transform: uppercase;">Active Course</label>
                <select id="course-dropdown" class="custom-select">
                    <optgroup label="FCPS Series">
                        <option value="fcps_part1">📘 FCPS Part 1</option>
                        <option value="fcps_part2">📗 FCPS Part 2</option>
                        <option value="fcps_imm">📙 FCPS IMM</option>
                    </optgroup>
                    <optgroup label="MRCS Series">
                        <option value="mrcs_part1">🇬🇧 MRCS Part 1</option>
                        <option value="mrcs_part2">🏥 MRCS Part 2</option>
                    </optgroup>
                    <optgroup label="MBBS Journey">
                        <option value="mbbs_year1">🧬 MBBS Year 1</option>
                        <option value="mbbs_year2">🔬 MBBS Year 2</option>
                        <option value="mbbs_year3">💊 MBBS Year 3</option>
                        <option value="mbbs_year4">👂 MBBS Year 4</option>
                        <option value="mbbs_year5">🎓 MBBS Year 5</option>
                    </optgroup>
                </select>
            </div>

            <button onclick="launchCourse()" class="btn-solid" style="width: 100%; background: #10b981; border: none; padding: 1rem; border-radius: 10px; font-size: 1.1rem; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);">
                Launch Question Bank ➡
            </button>
        </div>

	</section>

    <script>
        // Set dropdown to previously selected course (if it exists)
        window.onload = () => {
            const savedCourse = localStorage.getItem('edeetos_active_course');
            if (savedCourse) {
                document.getElementById('course-dropdown').value = savedCourse;
            }
        };

        function launchCourse() {
            // Grab the selected value from the dropdown
            const selectedCourse = document.getElementById('course-dropdown').value;
            
            // Save it to local storage
            localStorage.setItem('edeetos_active_course', selectedCourse);
            
            // Redirect to the universal Question Bank Engine
            window.location.href = 'questions.html';
        }
    </script>
    <script type="module" src="dashboard.js"></script>

</body>
</html>