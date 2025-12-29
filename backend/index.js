require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;
const db = new sqlite3.Database(process.env.DATABASE_PATH || './employee.db');

app.use(cors());
app.use(express.json());

// Basic test route
app.get('/', (req, res) => {
  res.send('Employee Management API is running');
});

// TODO: Add modules for: HR Database, Recruitment, Onboarding, Performance Management, Benefits Administration, Time and Attendance, Leave Management, Payroll, Workforce Management, Succession Planning, HR Analytics

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
