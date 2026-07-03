# CBK INFOTECH - Human Resource Management System (HRMS)

A professional, modern HRMS built with HTML5, CSS3, Vanilla JavaScript, and Firebase.

## Features
- **Clean Architecture & Modular JS**: Separate modules for `admin`, `employee`, `attendance`, `payroll`, and `auth`.
- **Premium UI/UX**: Custom styling with glassmorphism, responsive grids, and modern color palette (Indigo, Emerald, Amber).
- **Role-Based Access**: Dedicated portals and dashboards for Admins and Employees.
- **Firebase Ready**: Pre-configured structure for Firebase Authentication, Firestore, and Storage integration.

## Setup Instructions
1. Clone or download this repository.
2. Open `js/firebase-config.js` and replace the placeholder `firebaseConfig` object with your actual Firebase project settings.
3. Serve the project locally (e.g. using VS Code Live Server or Python's HTTP Server):
   ```bash
   npx serve .
   ```
   *Note: Because we use ES6 modules (`type="module"`), opening the HTML files directly from the file system (`file://`) will result in CORS errors in modern browsers.*
4. Open `index.html` in your browser.

## Project Structure
- `index.html`: Landing page
- `login.html`: Portal selection
- `admin-dashboard.html` / `employee-dashboard.html`: The main user interfaces
- `css/`: Global styles, layout configurations, and responsive media queries
- `js/`: Application logic broken down into functional modules
