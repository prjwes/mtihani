const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const xlsx = require('xlsx');
const app = express();

// Middleware
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false
}));
const upload = multer({ dest: 'uploads/' });
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Database Setup
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error(err.message);
  console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    name TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    gender TEXT,
    adm_number TEXT UNIQUE,
    grade INTEGER,
    age INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learner_id INTEGER,
    exam_type TEXT,
    subject TEXT,
    mark INTEGER,
    FOREIGN KEY (learner_id) REFERENCES learners(id)
  )`);

  // Predefine users
  const defaultPassword = 'paradise';
  const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
  const users = ['TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'TR6'];
  users.forEach(user => {
    db.run(`INSERT OR IGNORE INTO users (username, password, name) VALUES (?, ?, ?)`, [user, hashedPassword, user]);
  });
});

// Utility Functions
function getRubricAndComment(mark) {
  if (mark <= 10) return { rubric: 0.5, comment: 'BE2' };
  if (mark <= 20) return { rubric: 1.0, comment: 'BE1' };
  if (mark <= 30) return { rubric: 1.5, comment: 'AE2' };
  if (mark <= 40) return { rubric: 2.0, comment: 'AE1' };
  if (mark <= 57) return { rubric: 2.5, comment: 'ME2' };
  if (mark <= 74) return { rubric: 3.0, comment: 'ME1' };
  if (mark <= 89) return { rubric: 3.5, comment: 'EE2' };
  return { rubric: 4.0, comment: 'EE1' };
}

// Routes
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('home', { user: req.session.user });
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Invalid credentials' });
    }
    req.session.user = user;
    res.redirect('/');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.post('/change-name', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const newName = req.body.name;
  db.run(`UPDATE users SET name = ? WHERE id = ?`, [newName, req.session.user.id], (err) => {
    if (err) return res.status(500).send('Error updating name');
    req.session.user.name = newName;
    res.redirect('/');
  });
});

app.post('/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { currentPassword, newPassword } = req.body;
  if (!bcrypt.compareSync(currentPassword, req.session.user.password)) {
    return res.status(400).send('Current password incorrect');
  }
  const hashedNewPassword = bcrypt.hashSync(newPassword, 10);
  db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedNewPassword, req.session.user.id], (err) => {
    if (err) return res.status(500).send('Error updating password');
    req.session.user.password = hashedNewPassword;
    res.redirect('/');
  });
});

app.post('/reset-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const hashedDefaultPassword = bcrypt.hashSync('paradise', 10);
  db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedDefaultPassword, req.session.user.id], (err) => {
    if (err) return res.status(500).send('Error resetting password');
    req.session.user.password = hashedDefaultPassword;
    res.redirect('/');
  });
});

app.get('/add-learner', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('add-learner');
});

app.post('/add-learner', (req, res) => {
  const { name, gender, adm_number, grade, age } = req.body;
  db.run(`INSERT INTO learners (name, gender, adm_number, grade, age) VALUES (?, ?, ?, ?, ?)`, 
    [name, gender, adm_number, grade, age], (err) => {
      if (err) return res.status(500).send('Error adding learner');
      res.redirect('/');
    });
});

app.get('/upload/grade/:grade', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('upload-grade', { grade: req.params.grade });
});

app.post('/upload/grade/:grade', upload.single('excelFile'), (req, res) => {
  const grade = parseInt(req.params.grade);
  const examType = req.body.examType;
  const workbook = xlsx.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const schoolName = sheet['A1'] ? sheet['A1'].v : 'St. Michael Ebushibo Comprehensive School';
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1, range: 3 });

  const subjects = grade <= 6 ? 
    ['eng', 'kisw', 'math', 'sci_tech', 'c.r.e', 'c.a_sports', 'sst', 'agric'] :
    ['eng', 'kisw', 'math', 'int_sc', 'c.r.e', 'c.a_sports', 'pre_tech', 'sst', 'agric'];

  data.forEach((row, index) => {
    if (index === 0) return; // Skip header row
    const adm = row[1]; // Column B
    const name = row[2]; // Column C
    db.get(`SELECT id FROM learners WHERE adm_number = ? AND grade = ?`, [adm, grade], (err, learner) => {
      if (!learner) return;
      subjects.forEach((subject, i) => {
        const mark = row[3 + i]; // Columns D to L
        if (mark != null) {
          db.run(`INSERT OR REPLACE INTO marks (learner_id, exam_type, subject, mark) VALUES (?, ?, ?, ?)`, 
            [learner.id, examType, subject, mark]);
        }
      });
    });
  });
  res.redirect('/');
});

app.get('/upload-marks', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.all(`SELECT DISTINCT grade FROM learners ORDER BY grade`, (err, grades) => {
    res.render('upload-marks', { grades });
  });
});

app.post('/upload-marks', (req, res) => {
  const { grade, learnerId, examType, marks } = req.body;
  Object.entries(marks).forEach(([subject, mark]) => {
    if (mark) {
      db.run(`INSERT OR REPLACE INTO marks (learner_id, exam_type, subject, mark) VALUES (?, ?, ?, ?)`, 
        [learnerId, examType, subject, mark]);
    }
  });
  res.redirect('/upload-marks');
});

app.get('/direct-marks-upload', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.all(`SELECT DISTINCT grade FROM learners ORDER BY grade`, (err, grades) => {
    res.render('direct-marks-upload', { grades, learners: null, grade: null });
  });
});

app.post('/direct-marks-upload/grade', (req, res) => {
  const grade = req.body.grade;
  db.all(`SELECT * FROM learners WHERE grade = ?`, [grade], (err, learners) => {
    res.render('direct-marks-upload', { grades: null, learners, grade });
  });
});

app.post('/direct-marks-upload/save', (req, res) => {
  const { grade, examType, marks } = req.body;
  Object.entries(marks).forEach(([learnerId, subjects]) => {
    Object.entries(subjects).forEach(([subject, mark]) => {
      if (mark) {
        db.run(`INSERT OR REPLACE INTO marks (learner_id, exam_type, subject, mark) VALUES (?, ?, ?, ?)`, 
          [learnerId, examType, subject, mark]);
      }
    });
  });
  res.redirect('/direct-marks-upload');
});

app.get('/records', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('records');
});

app.get('/records/learners', (req, res) => {
  db.all(`SELECT DISTINCT grade FROM learners ORDER BY grade`, (err, grades) => {
    res.render('records-learners', { grades });
  });
});

app.get('/records/learners/grade/:grade', (req, res) => {
  const grade = req.params.grade;
  db.all(`SELECT * FROM learners WHERE grade = ?`, [grade], (err, learners) => {
    res.render('records-learners', { grades: null, learners, grade });
  });
});

app.post('/records/learners/promote', (req, res) => {
  const { learners } = req.body;
  learners.forEach(learnerId => {
    db.get(`SELECT grade FROM learners WHERE id = ?`, [learnerId], (err, row) => {
      let newGrade = row.grade + 1;
      if (newGrade > 9) newGrade = 'Graduated';
      db.run(`UPDATE learners SET grade = ? WHERE id = ?`, [newGrade, learnerId]);
    });
  });
  res.redirect('/records/learners');
});

app.get('/records/learners/marks/:id', (req, res) => {
  const learnerId = req.params.id;
  db.get(`SELECT * FROM learners WHERE id = ?`, [learnerId], (err, learner) => {
    db.all(`SELECT * FROM marks WHERE learner_id = ?`, [learnerId], (err, marks) => {
      res.render('learner-marks', { learner, marks });
    });
  });
});

app.post('/records/learners/marks/edit', (req, res) => {
  const { markId, mark } = req.body;
  db.run(`UPDATE marks SET mark = ? WHERE id = ?`, [mark, markId], () => {
    res.redirect('/records/learners');
  });
});

app.post('/records/learners/marks/delete', (req, res) => {
  const { markId, learnerId } = req.body;
  db.run(`DELETE FROM marks WHERE id = ?`, [markId], () => {
    res.redirect(`/records/learners/marks/${learnerId}`);
  });
});

app.get('/records/uploads', (req, res) => {
  db.all(`SELECT l.name, l.adm_number, l.grade, m.* FROM marks m JOIN learners l ON m.learner_id = l.id`, (err, marks) => {
    res.render('records-uploads', { marks });
  });
});

app.get('/records/cards', (req, res) => {
  db.all(`SELECT DISTINCT grade FROM learners ORDER BY grade`, (err, grades) => {
    res.render('records-cards', { grades });
  });
});

app.get('/generate-cards/grade/:grade', (req, res) => {
  const grade = parseInt(req.params.grade);
  db.all(`SELECT * FROM learners WHERE grade = ?`, [grade], (err, learners) => {
    const workbook = xlsx.utils.book_new();
    const subjects = grade <= 6 ? 
      ['eng', 'kisw', 'math', 'sci_tech', 'c.r.e', 'c.a_sports', 'sst', 'agric'] :
      ['eng', 'kisw', 'math', 'int_sc', 'c.r.e', 'c.a_sports', 'pre_tech', 'sst', 'agric'];

    learners.forEach(learner => {
      const sheetData = [
        ['St. Michael Ebushibo Comprehensive School'],
        [`Name: ${learner.name}`, `Adm: ${learner.adm_number}`, `Grade: ${grade}`, `Year: ${new Date().getFullYear()}`],
        ['Subjects', 'Exam 1', 'Rubric', 'Exam 2', 'Rubric', 'Comments']
      ];
      db.all(`SELECT * FROM marks WHERE learner_id = ?`, [learner.id], (err, marks) => {
        subjects.forEach((subject, i) => {
          const exam1 = marks.find(m => m.exam_type === 'exam1' && m.subject === subject);
          const exam2 = marks.find(m => m.exam_type === 'exam2' && m.subject === subject);
          const r1 = exam1 ? getRubricAndComment(exam1.mark) : { rubric: '', comment: '' };
          const r2 = exam2 ? getRubricAndComment(exam2.mark) : { rubric: '', comment: '' };
          sheetData.push([subject, exam1?.mark || '', r1.rubric, exam2?.mark || '', r2.rubric, r1.comment || r2.comment]);
        });
        const endRow = subjects.length + 3;
        sheetData.push(['Class Teacher\'s Remarks:']);
        sheetData.push(['Signature:']);
        sheetData.push(['Head of Institution\'s Remarks:']);
        sheetData.push(['Signature:']);
        sheetData.push(['Term ends on: ______']);
        sheetData.push(['Next term begins on: ______']);
        const sheet = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(workbook, sheet, learner.name.slice(0, 31));
      });
    });

    setTimeout(() => {
      const filePath = `cards_grade_${grade}.xlsx`;
      xlsx.writeFile(workbook, filePath);
      res.download(filePath);
    }, 1000);
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

// views/login.ejs
const loginEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Login</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Login</h1>
  <form method="POST" action="/login">
    <label>Username: <input type="text" name="username" required></label><br>
    <label>Password: <input type="password" name="password" required></label><br>
    <button type="submit">Login</button>
  </form>
  <% if (error) { %>
    <p class="error"><%= error %></p>
  <% } %>
</body>
</html>
`;

// views/home.ejs
const homeEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Home</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Welcome, <%= user.name %></h1>
  <div class="user-actions">
    <form method="POST" action="/change-name">
      <label>Change Name: <input type="text" name="name" value="<%= user.name %>"></label>
      <button type="submit">Update</button>
    </form>
    <form method="POST" action="/change-password">
      <label>Current Password: <input type="password" name="currentPassword" required></label>
      <label>New Password: <input type="password" name="newPassword" required></label>
      <button type="submit">Change Password</button>
    </form>
    <form method="POST" action="/reset-password">
      <button type="submit">Reset Password to 'paradise'</button>
    </form>
    <a href="/logout">Logout</a>
  </div>
  <div class="containers">
    <div class="container"><a href="/add-learner">Add Learners</a></div>
    <div class="container"><a href="/upload-marks">Upload Marks</a></div>
    <div class="container"><a href="/records">Records</a></div>
  </div>
  <div class="grade-grid">
    <% for (let i = 1; i <= 9; i++) { %>
      <div class="grade-container">
        <h2>Grade <%= i %></h2>
        <a href="/upload/grade/<%= i %>">Upload</a>
      </div>
    <% } %>
  </div>
</body>
</html>
`;

// views/add-learner.ejs
const addLearnerEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Add Learner</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Add Learner</h1>
  <form method="POST" action="/add-learner">
    <label>Name: <input type="text" name="name" required></label><br>
    <label>Gender: <input type="text" name="gender" required></label><br>
    <label>Adm Number: <input type="text" name="adm_number" required></label><br>
    <label>Grade: <select name="grade" required>
      <% for (let i = 1; i <= 9; i++) { %>
        <option value="<%= i %>"><%= i %></option>
      <% } %>
    </select></label><br>
    <label>Age: <input type="number" name="age" required></label><br>
    <button type="submit">Add</button>
  </form>
  <a href="/">Back</a>
</body>
</html>
`;

// views/upload-grade.ejs
const uploadGradeEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Upload Marks - Grade <%= grade %></title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Upload Marks for Grade <%= grade %></h1>
  <form method="POST" action="/upload/grade/<%= grade %>" enctype="multipart/form-data">
    <label>Exam Type: <select name="examType" required>
      <option value="exam1">Exam 1</option>
      <option value="exam2">Exam 2</option>
    </select></label><br>
    <label>Excel File: <input type="file" name="excelFile" accept=".xlsx" required></label><br>
    <button type="submit">Upload</button>
  </form>
  <a href="/">Back</a>
</body>
</html>
`;

// views/upload-marks.ejs
const uploadMarksEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Upload Marks</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Upload Marks</h1>
  <form method="POST" action="/upload-marks">
    <label>Grade: <select name="grade" onchange="this.form.submit()">
      <option value="">Select Grade</option>
      <% grades.forEach(g => { %>
        <option value="<%= g.grade %>"><%= g.grade %></option>
      <% }) %>
    </select></label><br>
    <% if (grade) { %>
      <label>Learner: <select name="learnerId" required>
        <% learners.forEach(l => { %>
          <option value="<%= l.id %>"><%= l.name %> (<%= l.adm_number %>)</option>
        <% }) %>
      </select></label><br>
      <label>Exam Type: <select name="examType" required>
        <option value="exam1">Exam 1</option>
        <option value="exam2">Exam 2</option>
      </select></label><br>
      <% const subjects = grade <= 6 ? 
        ['eng', 'kisw', 'math', 'sci_tech', 'c.r.e', 'c.a_sports', 'sst', 'agric'] :
        ['eng', 'kisw', 'math', 'int_sc', 'c.r.e', 'c.a_sports', 'pre_tech', 'sst', 'agric']; %>
      <% subjects.forEach(subject => { %>
        <label><%= subject %>: <input type="number" name="marks[<%= subject %>]"></label><br>
      <% }) %>
      <button type="submit">Save</button>
    <% } %>
  </form>
  <a href="/direct-marks-upload">Direct Marks Upload</a>
  <a href="/">Back</a>
</body>
</html>
`;

// views/direct-marks-upload.ejs
const directMarksUploadEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Direct Marks Upload</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Direct Marks Upload</h1>
  <% if (!learners) { %>
    <form method="POST" action="/direct-marks-upload/grade">
      <label>Grade: <select name="grade" required>
        <% grades.forEach(g => { %>
          <option value="<%= g.grade %>"><%= g.grade %></option>
        <% }) %>
      </select></label><br>
      <button type="submit">Select</button>
    </form>
  <% } else { %>
    <form method="POST" action="/direct-marks-upload/save">
      <input type="hidden" name="grade" value="<%= grade %>">
      <label>Exam Type: <select name="examType" required>
        <option value="exam1">Exam 1</option>
        <option value="exam2">Exam 2</option>
      </select></label><br>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <% const subjects = grade <= 6 ? 
              ['eng', 'kisw', 'math', 'sci_tech', 'c.r.e', 'c.a_sports', 'sst', 'agric'] :
              ['eng', 'kisw', 'math', 'int_sc', 'c.r.e', 'c.a_sports', 'pre_tech', 'sst', 'agric']; %>
            <% subjects.forEach(subject => { %>
              <th><%= subject %></th>
            <% }) %>
          </tr>
        </thead>
        <tbody>
          <% learners.forEach(learner => { %>
            <tr>
              <td><%= learner.name %></td>
              <% subjects.forEach(subject => { %>
                <td><input type="number" name="marks[<%= learner.id %>][<%= subject %>]"></td>
              <% }) %>
            </tr>
          <% }) %>
        </tbody>
      </table>
      <button type="submit">Save</button>
    </form>
  <% } %>
  <a href="/">Back</a>
</body>
</html>
`;

// views/records.ejs
const recordsEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Records</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Records</h1>
  <ul>
    <li><a href="/records/learners">View Learners</a></li>
    <li><a href="/records/uploads">View Uploads</a></li>
    <li><a href="/records/cards">View Cards</a></li>
  </ul>
  <a href="/">Back</a>
</body>
</html>
`;

// views/records-learners.ejs
const recordsLearnersEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>View Learners</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>View Learners</h1>
  <% if (grades) { %>
    <ul>
      <% grades.forEach(g => { %>
        <li><a href="/records/learners/grade/<%= g.grade %>">Grade <%= g.grade %></a></li>
      <% }) %>
    </ul>
  <% } else { %>
    <form method="POST" action="/records/learners/promote">
      <h2>Grade <%= grade %></h2>
      <ul>
        <% learners.forEach(learner => { %>
          <li>
            <input type="checkbox" name="learners" value="<%= learner.id %>">
            <a href="/records/learners/marks/<%= learner.id %>"><%= learner.name %> (<%= learner.adm_number %>)</a>
          </li>
        <% }) %>
      </ul>
      <button type="submit">Promote Selected</button>
    </form>
  <% } %>
  <a href="/records">Back</a>
</body>
</html>
`;

// views/learner-marks.ejs
const learnerMarksEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>Learner Marks</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1><%= learner.name %>'s Marks</h1>
  <table>
    <thead>
      <tr>
        <th>Subject</th>
        <th>Exam Type</th>
        <th>Mark</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <% marks.forEach(mark => { %>
        <tr>
          <td><%= mark.subject %></td>
          <td><%= mark.exam_type %></td>
          <td>
            <form method="POST" action="/records/learners/marks/edit">
              <input type="hidden" name="markId" value="<%= mark.id %>">
              <input type="number" name="mark" value="<%= mark.mark %>">
              <button type="submit">Edit</button>
            </form>
          </td>
          <td>
            <form method="POST" action="/records/learners/marks/delete">
              <input type="hidden" name="markId" value="<%= mark.id %>">
              <input type="hidden" name="learnerId" value="<%= learner.id %>">
              <button type="submit" onclick="return confirm('Delete this mark?')">Delete</button>
            </form>
          </td>
        </tr>
      <% }) %>
    </tbody>
  </table>
  <a href="/records/learners">Back</a>
</body>
</html>
`;

// views/records-uploads.ejs
const recordsUploadsEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>View Uploads</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>View Uploads</h1>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Adm</th>
        <th>Grade</th>
        <th>Subject</th>
        <th>Exam Type</th>
        <th>Mark</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <% marks.forEach(mark => { %>
        <tr>
          <td><%= mark.name %></td>
          <td><%= mark.adm_number %></td>
          <td><%= mark.grade %></td>
          <td><%= mark.subject %></td>
          <td><%= mark.exam_type %></td>
          <td>
            <form method="POST" action="/records/learners/marks/edit">
              <input type="hidden" name="markId" value="<%= mark.id %>">
              <input type="number" name="mark" value="<%= mark.mark %>">
              <button type="submit">Edit</button>
            </form>
          </td>
          <td>
            <form method="POST" action="/records/learners/marks/delete">
              <input type="hidden" name="markId" value="<%= mark.id %>">
              <input type="hidden" name="learnerId" value="<%= mark.learner_id %>">
              <button type="submit" onclick="return confirm('Delete this mark?')">Delete</button>
            </form>
          </td>
        </tr>
      <% }) %>
    </tbody>
  </table>
  <a href="/records">Back</a>
</body>
</html>
`;

// views/records-cards.ejs
const recordsCardsEjs = `
<!DOCTYPE html>
<html>
<head>
  <title>View Cards</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>View Cards</h1>
  <ul>
    <% grades.forEach(g => { %>
      <li>
        Grade <%= g.grade %> 
        <a href="/generate-cards/grade/<%= g.grade %>">Generate & Download</a>
      </li>
    <% }) %>
  </ul>
  <a href="/records">Back</a>
</body>
</html>
`;

// public/styles.css
const stylesCss = `
body {
  font-family: Arial, sans-serif;
  margin: 20px;
}
h1 {
  color: #333;
}
.error {
  color: red;
}
.containers, .grade-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}
.container, .grade-container {
  border: 1px solid #ccc;
  padding: 20px;
  text-align: center;
  width: 200px;
}
.grade-container a {
  display: block;
  margin-top: 10px;
  text-decoration: none;
  color: #007BFF;
}
.user-actions form {
  display: inline-block;
  margin-right: 10px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 20px;
}
th, td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}
th {
  background-color: #f2f2f2;
}
a {
  color: #007BFF;
  text-decoration: none;
}
button {
  padding: 5px 10px;
  background-color: #007BFF;
  color: white;
  border: none;
  cursor: pointer;
}
button:hover {
  background-color: #0056b3;
}
`;

// Write EJS files (simplified here; in practice, write to disk)
require('fs').writeFileSync(path.join(__dirname, 'views', 'login.ejs'), loginEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'home.ejs'), homeEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'add-learner.ejs'), addLearnerEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'upload-grade.ejs'), uploadGradeEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'upload-marks.ejs'), uploadMarksEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'direct-marks-upload.ejs'), directMarksUploadEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'records.ejs'), recordsEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'records-learners.ejs'), recordsLearnersEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'learner-marks.ejs'), learnerMarksEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'records-uploads.ejs'), recordsUploadsEjs);
require('fs').writeFileSync(path.join(__dirname, 'views', 'records-cards.ejs'), recordsCardsEjs);
require('fs').writeFileSync(path.join(__dirname, 'public', 'styles.css'), stylesCss);